from __future__ import annotations

import csv
import json
import os
import time
from pathlib import Path
from typing import Any

import requests

from ...pipelines.ecotrace_pipeline import ArticleMetadata
from ...services.analysis_runner import test_mediastack


MEDIASTACK_API_URL = "https://api.mediastack.com/v1/news"
MEDIASTACK_MAX_OFFSET = 10000
DATASET_COLUMNS = ("title", "description", "published_at", "source", "url")


def search_company_news_all(
    company_name: str,
    *,
    access_key: str | None = None,
    countries: str = "au",
    languages: str = "en",
    sort: str = "published_desc",
    page_limit: int = 100,
    sleep_seconds: float = 0.25,
) -> tuple[list[ArticleMetadata], int | None]:
    """
    Fetch all Mediastack pages for a company-name query.

    Mediastack reports the full result count in pagination.total but only
    returns one page at a time. This follows offsets until that total is reached
    or Mediastack's offset ceiling is hit.
    """

    key = access_key or os.getenv("MEDIASTACK_API_KEY")
    if not key:
        return [], None

    limit = max(1, min(page_limit, 100))
    offset = 0
    total_articles: int | None = None
    articles: list[ArticleMetadata] = []

    while offset < MEDIASTACK_MAX_OFFSET:
        params = {
            "access_key": key,
            "keywords": company_name,
            "countries": countries,
            "languages": languages,
            "sort": sort,
            "limit": str(limit),
            "offset": str(offset),
        }
        response = requests.get(MEDIASTACK_API_URL, params=params, timeout=45)
        response.raise_for_status()
        data = response.json()

        if "error" in data:
            message = data["error"].get("message", "Unknown Mediastack API error")
            raise RuntimeError(message)

        if total_articles is None:
            pagination = data.get("pagination") or {}
            total = pagination.get("total")
            total_articles = int(total) if total is not None else None

        page_items = data.get("data") or []
        if not page_items:
            break

        articles.extend(_metadata_from_item(item) for item in page_items)
        offset += limit

        if total_articles is not None and offset >= total_articles:
            break
        time.sleep(sleep_seconds)

    return articles, total_articles


def _metadata_from_item(item: dict[str, Any]) -> ArticleMetadata:
    return ArticleMetadata(
        title=str(item.get("title") or ""),
        snippet=str(item.get("description") or item.get("content") or "")[:500],
        source=str(item.get("source") or "Mediastack"),
        published_date=str(item.get("published_at") or item.get("publishedAt") or ""),
        url=str(item.get("url") or ""),
    )


def fetch_mediastack_news(
    access_key: str | None = None,
    *,
    keywords: str = "coles",
    countries: str = "au",
    start_date: str = "2022-04-10",
    end_date: str = "2026-04-10",
    page_limit: int = 100,
    resume_json_path: str | os.PathLike[str] | None = None,
    sleep_seconds: float = 1.0,
) -> list[dict[str, Any]]:
    """
    Fetch paginated Mediastack articles for offline analysis.

    This is intentionally separate from `test_mediastack`, which is the app's
    lightweight search provider used by the analysis pipeline.
    """

    key = access_key or os.getenv("MEDIASTACK_API_KEY")
    if not key:
        raise ValueError("MEDIASTACK_API_KEY is required")

    limit = max(1, min(page_limit, 100))
    all_articles = _load_existing_articles(resume_json_path)
    offset = len(all_articles)
    total_articles: int | None = None

    while offset < MEDIASTACK_MAX_OFFSET:
        params = {
            "access_key": key,
            "keywords": keywords,
            "countries": countries,
            "date": f"{start_date},{end_date}",
            "limit": limit,
            "offset": offset,
            "sort": "published_asc",
        }

        response = requests.get(MEDIASTACK_API_URL, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()

        if "error" in data:
            message = data["error"].get("message", "Unknown Mediastack API error")
            raise RuntimeError(message)

        if total_articles is None:
            pagination = data.get("pagination") or {}
            total = pagination.get("total")
            total_articles = int(total) if total is not None else None

        articles = data.get("data") or []
        if not articles:
            break

        all_articles.extend(articles)
        _save_articles(resume_json_path, all_articles)

        offset += limit
        if total_articles is not None and offset >= total_articles:
            break

        time.sleep(sleep_seconds)

    return all_articles


def fetch_mediastack_news_to_csv(
    access_key: str | None = None,
    *,
    keywords: str = "coles",
    countries: str = "au",
    start_date: str = "2022-04-10",
    end_date: str = "2026-04-10",
    json_path: str | os.PathLike[str] = "mediastack_news_dataset.json",
    csv_path: str | os.PathLike[str] = "mediastack_news_dataset.csv",
) -> list[dict[str, Any]]:
    articles = fetch_mediastack_news(
        access_key,
        keywords=keywords,
        countries=countries,
        start_date=start_date,
        end_date=end_date,
        resume_json_path=json_path,
    )
    write_mediastack_csv(articles, csv_path)
    return articles


def write_mediastack_csv(
    articles: list[dict[str, Any]],
    csv_path: str | os.PathLike[str],
) -> None:
    path = Path(csv_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=DATASET_COLUMNS)
        writer.writeheader()
        for article in articles:
            writer.writerow({column: article.get(column, "") for column in DATASET_COLUMNS})


def _load_existing_articles(
    json_path: str | os.PathLike[str] | None,
) -> list[dict[str, Any]]:
    if not json_path:
        return []

    path = Path(json_path)
    if not path.exists():
        return []

    with path.open(encoding="utf-8") as json_file:
        data = json.load(json_file)
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, dict)]


def _save_articles(
    json_path: str | os.PathLike[str] | None,
    articles: list[dict[str, Any]],
) -> None:
    if not json_path:
        return

    path = Path(json_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as json_file:
        json.dump(articles, json_file, indent=2, ensure_ascii=False)


search = test_mediastack

__all__ = [
    "fetch_mediastack_news",
    "fetch_mediastack_news_to_csv",
    "search",
    "search_company_news_all",
    "test_mediastack",
    "write_mediastack_csv",
]


if __name__ == "__main__":
    fetch_mediastack_news_to_csv()
