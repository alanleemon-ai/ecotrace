"""
Company analysis helpers for Seeco.

This module adapts the news, report, and LLM evidence pipeline without folding
that logic back into main.py.
"""

from __future__ import annotations

import json
import math
import os
import re
import threading
import time
import urllib.error
import urllib.request
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, UploadFile

from ..pipelines.abn_pipeline import clean_abn, is_abn, search_company_name_with_abr, verify_abn_with_abr
from ..pipelines.ecotrace_pipeline import (
    DEFAULT_NVIDIA_NIM_MODEL,
    DEFAULT_OPENROUTER_MODEL,
    NVIDIA_NIM_API_URL,
    OPENROUTER_API_URL,
    ArticleMetadata,
    UploadedReportTextReader,
    normalize_nvidia_model_name,
    parse_json_object,
)
from .analysis_runner import (
    article_candidate_score,
    biodiversity_article_priority_score,
    build_company_search_queries,
    classify_article_for_analysis,
    classified_article_payload,
    company_search_name,
    dedupe_article_metadata,
    has_carbon_offset_only_signal,
    has_climate_only_signal,
    has_retail_noise_signal,
    related_classified_articles,
    resolve_report_paths,
    test_openrouter_many,
    test_uploaded_reports,
)
from ..providers.news.mediastack import search_company_news_all


REPO_ROOT = Path(__file__).resolve().parents[3]
REPORTS_DIR = REPO_ROOT / "reports"
_ANALYSIS_PROGRESS = threading.local()


def set_analysis_progress_callback(callback) -> None:
    _ANALYSIS_PROGRESS.callback = callback


def clear_analysis_progress_callback() -> None:
    if hasattr(_ANALYSIS_PROGRESS, "callback"):
        delattr(_ANALYSIS_PROGRESS, "callback")


def max_report_upload_bytes() -> int:
    try:
        limit_mb = int(os.getenv("MAX_REPORT_UPLOAD_MB", os.getenv("MAX_UPLOAD_MB", "10")))
    except ValueError:
        limit_mb = 10
    return limit_mb * 1024 * 1024

SUPPORTED_REPORT_EXTENSIONS = {
    ".pdf",
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".json",
    ".html",
    ".htm",
}

KNOWN_COMPANY_ABNS = {
    "bhp": "49004028077",
    "bhp group": "49004028077",
    "bhp group limited": "49004028077",
    "coles": "11004089936",
    "coles group": "11004089936",
    "coles group limited": "11004089936",
    "woolworths": "88000014675",
    "woolworths group": "88000014675",
    "woolworths group limited": "88000014675",
    "bega": "81008358503",
    "bega cheese": "81008358503",
}


def safe_report_filename(filename: str) -> str:
    name = Path(filename or "uploaded-report").name
    name = re.sub(r"[^A-Za-z0-9._ -]+", "_", name).strip(" .")
    return name or "uploaded-report"


def save_uploaded_reports(files: Optional[List[UploadFile]]) -> List[str]:
    if not files:
        return []

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    saved_paths: List[str] = []
    max_bytes = max_report_upload_bytes()
    max_mb = max_bytes // (1024 * 1024)

    for upload in files:
        filename = safe_report_filename(upload.filename or "")
        extension = Path(filename).suffix.lower()
        if extension not in SUPPORTED_REPORT_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported report file type: {extension or 'none'}",
            )

        target = REPORTS_DIR / filename
        if target.exists():
            target = REPORTS_DIR / f"{target.stem}-{int(time.time())}{target.suffix}"

        bytes_written = 0
        try:
            with target.open("wb") as output:
                while True:
                    chunk = upload.file.read(1024 * 1024)
                    if not chunk:
                        break
                    bytes_written += len(chunk)
                    if bytes_written > max_bytes:
                        raise HTTPException(
                            status_code=413,
                            detail=(
                                "Report file exceeds the "
                                f"{max_mb} MB limit."
                            ),
                        )
                    output.write(chunk)
        except Exception:
            if target.exists():
                target.unlink()
            raise
        saved_paths.append(str(target))

    return saved_paths


def delete_temporary_reports(paths: List[str]) -> None:
    for path in paths:
        try:
            target = Path(path).resolve()
            if target.parent == REPORTS_DIR.resolve() and target.exists():
                target.unlink()
        except OSError:
            pass


COMPANY_NAME_STOPWORDS = {
    "limited",
    "ltd",
    "pty",
    "proprietary",
    "company",
    "co",
    "corporation",
    "corp",
    "inc",
    "group",
    "holdings",
    "holding",
    "australia",
    "australian",
    "the",
}


def filter_reports_for_company(
    report_paths: List[str],
    saved_to_original: Dict[str, str],
    resolution: Dict[str, Any],
) -> Tuple[List[str], List[Dict[str, str]]]:
    if not report_paths:
        return [], []

    terms = company_relevance_terms(resolution)
    if not terms:
        return report_paths, []

    reader = UploadedReportTextReader(max_chars=50000)
    company_name = resolution.get("normalized_name") or resolution.get("legal_name") or "the selected company"
    matched_paths: List[str] = []
    skipped_reports: List[Dict[str, str]] = []
    for path in report_paths:
        display_name = saved_to_original.get(Path(path).name, Path(path).name)
        try:
            report_text = report_relevance_text(reader, path)
        except Exception as error:
            skipped_reports.append(
                {
                    "name": display_name,
                    "reason": (
                        f"Could not read uploaded report '{display_name}' to verify it "
                        f"matches {company_name}: {error}"
                    ),
                }
            )
            continue

        if not report_text.strip():
            skipped_reports.append(
                {
                    "name": display_name,
                    "reason": f"Uploaded report '{display_name}' has no readable text.",
                }
            )
            continue

        if not report_mentions_company(report_text, terms):
            skipped_reports.append(
                {
                    "name": display_name,
                    "reason": (
                        f"Uploaded report '{display_name}' does not appear to match "
                        f"{company_name}. Upload a report that mentions the company "
                        "name, brand name, or ABN."
                    ),
                }
            )
            continue

        matched_paths.append(path)

    return matched_paths, skipped_reports


def company_relevance_terms(resolution: Dict[str, Any]) -> List[str]:
    raw_terms: List[str] = []
    for key in ("normalized_name", "legal_name", "input_value"):
        value = str(resolution.get(key) or "").strip()
        if value:
            raw_terms.extend(company_name_variants(value))

    alias_abn = clean_abn(str(resolution.get("alias_abn") or ""))
    if alias_abn:
        raw_terms.append(alias_abn)

    abr = resolution.get("abr") or {}
    abn = clean_abn(str(abr.get("abn") or ""))
    if abn:
        raw_terms.append(abn)

    seen = set()
    terms = []
    for term in raw_terms:
        normalized = normalize_company_match_text(term)
        if normalized and normalized not in seen:
            seen.add(normalized)
            terms.append(normalized)
    return terms


def company_name_variants(name: str) -> List[str]:
    normalized = normalize_company_match_text(name)
    tokens = [
        token
        for token in normalized.split()
        if token not in COMPANY_NAME_STOPWORDS and len(token) >= 3
    ]
    variants = [normalized]
    if tokens:
        variants.append(" ".join(tokens))
        variants.append(tokens[0])
    if len(tokens) >= 2:
        variants.append(" ".join(tokens[:2]))
    return variants


def normalize_company_match_text(value: str) -> str:
    value = value.lower()
    if value.isdigit():
        return clean_abn(value)
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return " ".join(value.split())


def report_relevance_text(reader: UploadedReportTextReader, path: str) -> str:
    pages = reader._read_report_pages(path)
    parts: List[str] = [Path(path).name]
    total_chars = 0
    for _page_number, page_text in pages:
        cleaned = " ".join(str(page_text or "").split())
        if not cleaned:
            continue
        parts.append(cleaned)
        total_chars += len(cleaned)
        if total_chars >= reader.max_chars:
            break
    return " ".join(parts)[: reader.max_chars]


def report_mentions_company(text: str, terms: List[str]) -> bool:
    normalized = normalize_company_match_text(text)
    normalized_abn = clean_abn(text)
    for term in terms:
        if term.isdigit() and term in normalized_abn:
            return True
        if len(term) >= 3 and re.search(rf"\b{re.escape(term)}\b", normalized):
            return True
    return False


def evidence_record_to_dict(record) -> Dict[str, Any]:
    if hasattr(record, "__dataclass_fields__"):
        return asdict(record)
    return dict(record)


def resolve_company_for_analysis(company_or_abn: str) -> Dict[str, Any]:
    value = company_or_abn.strip()
    if not value:
        raise HTTPException(status_code=400, detail="company_or_abn is required")

    alias_abn = KNOWN_COMPANY_ABNS.get(value.lower())
    if is_abn(value) or alias_abn:
        abn_result = verify_abn_with_abr(alias_abn or clean_abn(value))
        input_type = "abn"
    else:
        abn_result = search_company_name_with_abr(value)
        input_type = "company_name"

    legal_name = abn_result.get("legal_name") or value
    normalized_name = company_search_name(legal_name)

    return {
        "input_type": input_type,
        "input_value": value,
        "alias_abn": alias_abn,
        "abr": abn_result,
        "legal_name": legal_name,
        "normalized_name": normalized_name,
        "queries": [normalized_name],
        "classification_topics": build_company_search_queries(normalized_name),
    }


def collect_news_evidence(
    company_name: str,
    queries: List[str],
    limit: int = 3,
    max_llm_results: int = 5,
    australia_only: bool = True,
    progress_callback=None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    if progress_callback is None:
        progress_callback = getattr(_ANALYSIS_PROGRESS, "callback", None)
    company_query = company_search_name(company_name)
    sample_articles, mediastack_total = search_company_news_all(company_query)
    articles = dedupe_article_metadata(sample_articles)
    search_meta = {
        "provider": "mediastack",
        "query": company_query,
        "page_limit": 100,
        "reported_total": mediastack_total,
        "raw_article_count": len(sample_articles),
        "deduped_article_count": len(articles),
    }

    candidates = related_classified_articles(company_name, articles, australia_only)
    candidates = [
        article
        for article in candidates
        if article_candidate_score(company_name, article, False) >= 80
    ]

    selected_keys = {
        ((article.url or "").strip().lower(), article.title.strip().lower())
        for article in candidates
    }
    classified_payloads = []
    for article in articles:
        payload = classified_article_payload(company_name, article, False)
        key = ((article.url or "").strip().lower(), article.title.strip().lower())
        payload["selected_for_llm"] = key in selected_keys
        classified_payloads.append(payload)

    candidate_payloads = [
        payload for payload in classified_payloads if payload["selected_for_llm"]
    ]
    quick_results = batch_quick_llm_triage(
        company_name,
        candidates,
        progress_callback=progress_callback,
    )
    embedding_results = batch_nvidia_embedding_triage(company_name, candidates)
    ranking_results = quick_results + embedding_results
    quick_by_url = {
        str(item.get("url") or ""): item
        for item in ranking_results
        if item.get("url")
    }
    full_text_candidates = select_full_text_candidates(
        company_name,
        candidates,
        ranking_results,
        limit=news_full_text_llm_limit(max_llm_results),
    )
    full_text_keys = {
        ((article.url or "").strip().lower(), article.title.strip().lower())
        for article in full_text_candidates
    }

    for payload in candidate_payloads:
        quick = quick_by_url.get(str(payload.get("url") or ""))
        if quick:
            payload["quick_llm_priority"] = quick.get("priority")
            payload["quick_llm_evidence_type"] = quick.get("evidence_type")
            payload["quick_llm_reason"] = quick.get("reason")
        key = (
            str(payload.get("url") or "").strip().lower(),
            str(payload.get("title") or "").strip().lower(),
        )
        payload["selected_for_full_text_llm"] = key in full_text_keys

    if not candidates:
        return classified_payloads, candidate_payloads, [], search_meta

    if progress_callback:
        progress_callback(0, len(full_text_candidates), None)
    full_text_records = test_openrouter_many(
        company_name,
        full_text_candidates,
        fetch_full_text=True,
        australia_only=australia_only,
        progress_callback=progress_callback,
    )
    records = usable_evidence_records(full_text_records)
    search_meta["llm_strategy"] = "two_stage"
    search_meta["quick_llm_count"] = len(candidates)
    search_meta["quick_llm_batch_count"] = batch_count(len(candidates), quick_llm_batch_size())
    search_meta["embedding_rerank_enabled"] = nvidia_embedding_rerank_enabled()
    search_meta["embedding_rerank_model"] = nvidia_embedding_model()
    search_meta["embedding_rerank_count"] = len(embedding_results)
    search_meta["full_text_llm_count"] = len(full_text_candidates)
    search_meta["full_text_llm_limit"] = news_full_text_llm_limit(max_llm_results)
    search_meta["full_text_llm_records_returned"] = len(records)
    search_meta["unknown_records_filtered"] = len(full_text_records) - len(records)
    return (
        classified_payloads,
        candidate_payloads,
        [evidence_record_to_dict(record) for record in records],
        search_meta,
    )


def news_full_text_llm_limit(requested_limit: int | None = None) -> int:
    default_limit = requested_limit if requested_limit and requested_limit > 0 else 5
    try:
        env_limit = int(os.getenv("NEWS_FULL_TEXT_LLM_LIMIT", str(default_limit)))
    except ValueError:
        env_limit = default_limit
    return max(1, min(default_limit, env_limit))


def usable_evidence_records(records):
    usable = []
    for record in records:
        evidence_type = str(getattr(record, "evidence_type", "") or "").strip().lower()
        signal = str(getattr(record, "biodiversity_signal", "") or "").strip().lower()
        text = " ".join(
            str(value or "")
            for value in (
                getattr(record, "biodiversity_signal", None),
                getattr(record, "activity_type", None),
                getattr(record, "source", None),
                getattr(record, "source_url", None),
                getattr(record, "notes", None),
            )
        ).lower()
        if evidence_type == "unknown":
            continue
        if signal in {"", "unknown", "none", "n/a", "not specified"}:
            continue
        if has_carbon_offset_only_signal(text):
            continue
        usable.append(record)
    return usable


def quick_llm_batch_size() -> int:
    try:
        return max(1, min(int(os.getenv("NEWS_QUICK_LLM_BATCH_SIZE", "40")), 50))
    except ValueError:
        return 40


def batch_count(total: int, size: int) -> int:
    return (total + size - 1) // size if total > 0 else 0


BIODIVERSITY_EMBEDDING_QUERIES = [
    (
        "biodiversity risk habitat loss threatened species land clearing "
        "water pollution groundwater contamination mine impact protected areas"
    ),
    (
        "biodiversity action conservation rehabilitation restoration species "
        "monitoring environmental DNA habitat restoration nature positive"
    ),
    (
        "regulatory biodiversity signal EPBC environmental approval "
        "environmental watchdog compliance protected area offset conditions"
    ),
]


def nvidia_embedding_rerank_enabled() -> bool:
    return os.getenv("NEWS_EMBEDDING_RERANK_ENABLED", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def nvidia_embedding_model() -> str:
    return os.getenv("NVIDIA_EMBEDDING_MODEL", "nvidia/nv-embed-v1").strip() or "nvidia/nv-embed-v1"


def nvidia_embedding_api_url() -> str:
    return (
        os.getenv("NVIDIA_EMBEDDING_API_URL", "https://integrate.api.nvidia.com/v1/embeddings").strip()
        or "https://integrate.api.nvidia.com/v1/embeddings"
    )


def nvidia_embedding_api_key() -> str:
    return (
        os.getenv("NVIDIA_EMBEDDING_API_KEY", "").strip()
        or os.getenv("NVIDIA_API_KEY", "").strip()
    )


def nvidia_embedding_timeout_seconds() -> int:
    try:
        return max(5, min(int(os.getenv("NEWS_EMBEDDING_TIMEOUT_SECONDS", "20")), 90))
    except ValueError:
        return 20


def nvidia_embedding_batch_size() -> int:
    try:
        return max(1, min(int(os.getenv("NEWS_EMBEDDING_BATCH_SIZE", "32")), 96))
    except ValueError:
        return 32


def nvidia_embedding_min_score() -> float:
    try:
        return max(0.0, min(float(os.getenv("NEWS_EMBEDDING_MIN_SCORE", "0.35")), 1.0))
    except ValueError:
        return 0.35


def batch_nvidia_embedding_triage(
    company_name: str,
    candidates: list[ArticleMetadata],
) -> list[dict[str, Any]]:
    if not candidates or not nvidia_embedding_rerank_enabled():
        return []

    api_key = nvidia_embedding_api_key()
    if not api_key:
        print("[Embedding rerank] skipped: NVIDIA_EMBEDDING_API_KEY is not set")
        return []

    try:
        query_vectors = call_nvidia_embeddings(BIODIVERSITY_EMBEDDING_QUERIES, "query")
        results: list[dict[str, Any]] = []
        batch_size = nvidia_embedding_batch_size()
        for start in range(0, len(candidates), batch_size):
            batch = candidates[start : start + batch_size]
            passages = [article_embedding_text(company_name, article) for article in batch]
            passage_vectors = call_nvidia_embeddings(passages, "passage")
            for article, vector in zip(batch, passage_vectors):
                raw_score = max(cosine_similarity(vector, query) for query in query_vectors)
                adjusted_score, penalty_reasons = adjusted_embedding_score(article, raw_score)
                priority = max(0, min(100, round(adjusted_score * 100)))
                related = adjusted_score >= nvidia_embedding_min_score()
                reason = f"NVIDIA nv-embed semantic biodiversity score {raw_score:.2f}."
                if penalty_reasons:
                    reason += " Penalized for " + ", ".join(penalty_reasons) + "."
                results.append(
                    {
                        "url": article.url,
                        "title": article.title,
                        "related": related,
                        "evidence_type": "embedding rerank" if related else "unrelated",
                        "priority": priority,
                        "reason": reason,
                        "embedding_score": raw_score,
                        "embedding_adjusted_score": adjusted_score,
                    }
                )
        return results
    except Exception as error:
        print(f"[Embedding rerank] skipped: {type(error).__name__}: {error}")
        return []


def adjusted_embedding_score(article: ArticleMetadata, raw_score: float) -> tuple[float, list[str]]:
    text = f"{article.title} {article.snippet}".lower()
    adjusted = raw_score
    reasons: list[str] = []
    if has_retail_noise_signal(text):
        adjusted -= 0.25
        reasons.append("retail/market noise")
    if has_business_metaphor_noise_signal(text):
        adjusted -= 0.25
        reasons.append("business metaphor/noise")
    if has_carbon_offset_only_signal(text):
        adjusted -= 0.25
        reasons.append("carbon-only offset")
    if has_climate_only_signal(text):
        adjusted -= 0.15
        reasons.append("climate-only wording")
    return max(0.0, adjusted), reasons


def call_nvidia_embeddings(inputs: list[str], input_type: str) -> list[list[float]]:
    request_body = {
        "model": nvidia_embedding_model(),
        "input": inputs,
        "input_type": input_type,
        "encoding_format": "float",
        "truncate": "END",
    }
    request = urllib.request.Request(
        nvidia_embedding_api_url(),
        data=json.dumps(request_body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {nvidia_embedding_api_key()}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=nvidia_embedding_timeout_seconds()) as response:
        payload = json.loads(response.read().decode("utf-8"))

    vectors = []
    for item in payload.get("data") or []:
        embedding = item.get("embedding")
        if isinstance(embedding, list):
            vectors.append([float(value) for value in embedding])
    if len(vectors) != len(inputs):
        raise ValueError("NVIDIA embedding response did not include all input vectors")
    return vectors


def article_embedding_text(company_name: str, article: ArticleMetadata) -> str:
    parts = [
        f"Company: {company_name}",
        f"Title: {article.title}",
        f"Description: {article.snippet}",
        f"Source: {article.source}",
    ]
    return "\n".join(part for part in parts if part.strip())[:6000]


def cosine_similarity(left: list[float], right: list[float]) -> float:
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)


def batch_quick_llm_triage(
    company_name: str,
    candidates: list[ArticleMetadata],
    progress_callback=None,
) -> list[dict[str, Any]]:
    batch_size = quick_llm_batch_size()
    results: list[dict[str, Any]] = []
    total_batches = batch_count(len(candidates), batch_size)
    for batch_index, start in enumerate(range(0, len(candidates), batch_size), start=1):
        batch = candidates[start : start + batch_size]
        if progress_callback:
            progress_callback(batch_index, total_batches, None)
        try:
            results.extend(_call_quick_llm_batch(company_name, batch, start))
        except Exception as error:
            print(f"[Quick LLM] batch {batch_index}/{total_batches} failed: {type(error).__name__}: {error}")
            results.extend(_fallback_quick_triage(company_name, batch, start))
    return results


def _call_quick_llm_batch(
    company_name: str,
    batch: list[ArticleMetadata],
    start_index: int,
) -> list[dict[str, Any]]:
    if os.getenv("NEWS_QUICK_LLM_ENABLED", "true").strip().lower() in {"0", "false", "no", "off"}:
        return _fallback_quick_triage(company_name, batch, start_index)

    provider = os.getenv("LLM_PROVIDER", "openrouter").strip().lower() or "openrouter"
    if provider in {"nvidia", "nvidia_nim", "nim"}:
        api_key = os.getenv("NVIDIA_API_KEY")
        api_url = os.getenv("NVIDIA_NIM_API_URL", NVIDIA_NIM_API_URL)
        model = normalize_nvidia_model_name(
            os.getenv("NVIDIA_NIM_MODEL", DEFAULT_NVIDIA_NIM_MODEL)
        )
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    else:
        api_key = os.getenv("OPENROUTER_API_KEY")
        api_url = OPENROUTER_API_URL
        model = os.getenv("OPENROUTER_MODEL", DEFAULT_OPENROUTER_MODEL)
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": os.getenv("OPENROUTER_SITE_URL", "http://localhost"),
            "X-Title": os.getenv("OPENROUTER_APP_NAME", "Seeco"),
        }
    if not api_key:
        return _fallback_quick_triage(company_name, batch, start_index)

    article_payload = [
        {
            "id": start_index + index,
            "title": article.title,
            "description": article.snippet,
            "source": article.source,
            "date": article.published_date,
            "url": article.url,
        }
        for index, article in enumerate(batch)
    ]
    request_body = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Classify company news for biodiversity evidence triage. "
                    "Use only title and description. Return compact JSON only."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Company: {company_name}\n"
                    "For each article, return id, related boolean, evidence_type "
                    "(biodiversity risk, biodiversity action, regulatory signal, "
                    "environmental supply chain, or unrelated), priority 0-100, "
                    "and a short reason. JSON shape: "
                    "{\"articles\":[{\"id\":0,\"related\":true,\"evidence_type\":\"...\","
                    "\"priority\":80,\"reason\":\"...\"}]}.\n"
                    f"Articles: {json.dumps(article_payload, ensure_ascii=True)}"
                ),
            },
        ],
        "temperature": 0,
        "max_tokens": quick_llm_max_tokens(),
    }
    request = urllib.request.Request(
        api_url,
        data=json.dumps(request_body).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    last_error: Exception | None = None
    for attempt in range(quick_llm_attempts()):
        try:
            with urllib.request.urlopen(request, timeout=quick_llm_timeout_seconds()) as response:
                data = json.loads(response.read().decode("utf-8"))
            content = data["choices"][0]["message"].get("content") or ""
            parsed = parse_json_object(content)
            return _normalize_quick_batch_results(batch, parsed.get("articles") or [], start_index)
        except (TimeoutError, urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, KeyError, TypeError) as error:
            last_error = error
            if attempt + 1 < quick_llm_attempts():
                time.sleep(2 * (attempt + 1))
    if last_error:
        raise last_error
    return _fallback_quick_triage(company_name, batch, start_index)


def quick_llm_attempts() -> int:
    try:
        return max(1, min(int(os.getenv("NEWS_QUICK_LLM_ATTEMPTS", "1")), 3))
    except ValueError:
        return 1


def quick_llm_timeout_seconds() -> int:
    try:
        return max(5, min(int(os.getenv("NEWS_QUICK_LLM_TIMEOUT_SECONDS", "25")), 90))
    except ValueError:
        return 25


def quick_llm_max_tokens() -> int:
    try:
        return max(500, min(int(os.getenv("NEWS_QUICK_LLM_MAX_TOKENS", "1500")), 4000))
    except ValueError:
        return 1500


def _normalize_quick_batch_results(
    batch: list[ArticleMetadata],
    raw_results: list[dict[str, Any]],
    start_index: int,
) -> list[dict[str, Any]]:
    dict_results = [item for item in raw_results if isinstance(item, dict)]
    by_id = {
        int(item.get("id")): item
        for item in dict_results
        if str(item.get("id", "")).isdigit()
    }
    output = []
    for index, article in enumerate(batch):
        item = by_id.get(start_index + index)
        if item is None:
            matches = [value for value in dict_results if str(value.get("url") or "") == article.url]
            item = matches[0] if matches else {}
        output.append(
            {
                "url": article.url,
                "title": article.title,
                "related": bool(item.get("related", True)),
                "evidence_type": str(item.get("evidence_type") or "unrelated"),
                "priority": _clamp_priority(item.get("priority")),
                "reason": str(item.get("reason") or ""),
            }
        )
    return output


def _fallback_quick_triage(
    company_name: str,
    batch: list[ArticleMetadata],
    start_index: int,
) -> list[dict[str, Any]]:
    return [
        {
            "url": article.url,
            "title": article.title,
            "related": True,
            "evidence_type": "local classifier",
            "priority": min(100, max(0, article_candidate_score(company_name, article, False) // 5)),
            "reason": "Fallback local score after quick LLM batch failed.",
        }
        for article in batch
    ]


def _clamp_priority(value: Any) -> int:
    try:
        return max(0, min(100, int(float(value))))
    except (TypeError, ValueError):
        return 50


def select_full_text_candidates(
    company_name: str,
    candidates,
    quick_results,
    limit: int,
):
    quick_by_url = {
        str(item.get("url") or ""): item
        for item in quick_results
        if item.get("url")
    }

    def score(article) -> float:
        quick = quick_by_url.get(article.url)
        evidence_bonus = 0
        confidence_bonus = 0.0
        classification = classify_article_for_analysis(company_name, article, True)
        category = str(classification.get("category") or "")
        category_bonus = {
            "biodiversity risk": 1800,
            "biodiversity action": 1400,
            "regulatory signal": 900,
            "environmental supply chain": 300,
        }.get(category, 0)
        if quick:
            if quick.get("related") and quick.get("evidence_type") != "unrelated":
                evidence_bonus += 1000
            confidence_bonus = float(quick.get("priority") or 0)
        return (
            evidence_bonus
            + confidence_bonus
            + category_bonus
            + biodiversity_article_priority_score(company_name, article, True)
        )

    selected = []
    seen_stories: set[str] = set()
    for article in sorted(candidates, key=score, reverse=True):
        signature = article_story_signature(article)
        if signature in seen_stories:
            continue
        selected.append(article)
        seen_stories.add(signature)
        if len(selected) >= limit:
            break
    return selected


def article_story_signature(article: ArticleMetadata) -> str:
    url_path = ""
    try:
        from urllib.parse import urlparse

        url_path = urlparse(article.url or "").path
    except Exception:
        url_path = ""
    basis = url_path.rsplit("/", 1)[-1] or article.title
    basis = re.sub(r"\.(html?|php)$", "", basis.lower())
    basis = re.sub(r"p[0-9a-z]{5,}$", "", basis)
    basis = re.sub(r"[^a-z0-9]+", " ", basis)
    stop_words = {
        "the",
        "a",
        "an",
        "and",
        "to",
        "for",
        "of",
        "in",
        "on",
        "with",
        "as",
        "after",
        "before",
        "s",
    }
    tokens = [token for token in basis.split() if token and token not in stop_words]
    return " ".join(tokens[:10]) or (article.url or article.title).strip().lower()


def collect_report_evidence(
    company_name: str,
    report_paths: List[str],
    max_report_chunks: int = 3,
) -> List[Dict[str, Any]]:
    records = test_uploaded_reports(
        company_name,
        report_paths,
        max_report_chars=3000,
        max_report_chunks=max(1, min(max_report_chunks, 10)),
        australia_only=True,
    )
    return [evidence_record_to_dict(record) for record in records]
