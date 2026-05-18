import { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { Sidebar, PageId } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { EmailGateModal } from './components/EmailGateModal';
import { HelpProvider } from './help/HelpProvider';
import { getSessionStatus } from '../lib/api';

const titles: Record<string, { title: string; subtitle: string }> = {
  search: { title: 'Search', subtitle: 'Resolve a product, brand, or company' },
  overview: { title: 'Company Overview', subtitle: 'BHP Group Limited · ABN 49 004 028 077' },
  analyse: { title: 'News Analyze', subtitle: 'News evidence and source traceability' },
  watchlist: { title: 'Watchlist', subtitle: 'Track biodiversity risk changes' },
  spatial: { title: 'Spatial Analysis', subtitle: 'Biodiversity risk dashboard' },
};

const PROTECTED_PAGES = ['/app/watchlist'];

export function Root() {
  const location = useLocation();
  const navigate = useNavigate();
  const [emailVerified, setEmailVerified] = useState(() => localStorage.getItem('seeco_email_verified') === 'true');
  const [verificationChecked, setVerificationChecked] = useState(false);
  const [lastUnprotectedRoute, setLastUnprotectedRoute] = useState<string>('/app/search');

  const currentPath = location.pathname;
  const pageKey = currentPath.replace('/app/', '');
  const meta = titles[pageKey] || { title: 'Seeco', subtitle: '' };
  
  const isProtectedPage = PROTECTED_PAGES.includes(currentPath);
  const isCheckingProtectedPage = isProtectedPage && !verificationChecked;
  const requiresVerification = isProtectedPage && verificationChecked && !emailVerified;

  useEffect(() => {
    if (!isProtectedPage) {
      setVerificationChecked(true);
      return;
    }

    let cancelled = false;
    const storedEmail = localStorage.getItem('seeco_verified_email') || '';
    const storedSessionToken = localStorage.getItem('seeco_session_token') || '';
    if (!storedEmail || !storedSessionToken) {
      localStorage.removeItem('seeco_email_verified');
      localStorage.removeItem('seeco_user_id');
      localStorage.removeItem('seeco_session_token');
      setEmailVerified(false);
      setVerificationChecked(true);
      return;
    }

    setVerificationChecked(false);
    getSessionStatus()
      .then((result) => {
        if (cancelled) return;
        if (result.verified && result.user) {
          localStorage.setItem('seeco_email_verified', 'true');
          localStorage.setItem('seeco_verified_email', result.user.email);
          localStorage.setItem('seeco_user_id', result.user.user_id);
          setEmailVerified(true);
        } else {
          localStorage.removeItem('seeco_email_verified');
          localStorage.removeItem('seeco_user_id');
          localStorage.removeItem('seeco_session_token');
          setEmailVerified(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        localStorage.removeItem('seeco_email_verified');
        localStorage.removeItem('seeco_user_id');
        localStorage.removeItem('seeco_session_token');
        setEmailVerified(false);
      })
      .finally(() => {
        if (!cancelled) setVerificationChecked(true);
      });

    return () => {
      cancelled = true;
    };
  }, [currentPath, isProtectedPage]);

  useEffect(() => {
    const syncVerifiedState = () => {
      if (localStorage.getItem('seeco_email_verified') === 'true') {
        setEmailVerified(true);
        setVerificationChecked(true);
      }
    };
    window.addEventListener('storage', syncVerifiedState);
    window.addEventListener('seeco-email-verified', syncVerifiedState);
    return () => {
      window.removeEventListener('storage', syncVerifiedState);
      window.removeEventListener('seeco-email-verified', syncVerifiedState);
    };
  }, []);

  // Track the last unprotected route
  useEffect(() => {
    if (!isProtectedPage || emailVerified) {
      setLastUnprotectedRoute(currentPath);
    }
  }, [currentPath, emailVerified, isProtectedPage]);

  const handleCloseGate = () => {
    navigate(lastUnprotectedRoute);
  };

  const handleVerified = (email: string) => {
    localStorage.setItem('seeco_email_verified', 'true');
    localStorage.setItem('seeco_verified_email', email);
    setEmailVerified(true);
    setVerificationChecked(true);
  };

  return (
    <HelpProvider autoPrompt={!requiresVerification}>
      <div className="min-h-screen bg-stone-50 text-stone-900 flex">
        <Sidebar active={pageKey as PageId} />
        <div className="flex-1 min-w-0 relative flex flex-col">
          <TopBar title={meta.title} subtitle={meta.subtitle} />

          <div className={`flex-1 ${requiresVerification || isCheckingProtectedPage ? "h-[calc(100vh-64px)] overflow-hidden" : "overflow-y-auto"}`}>
            {isCheckingProtectedPage ? (
              <div className="flex h-full items-center justify-center text-[13px] text-stone-500">
                Checking watchlist access...
              </div>
            ) : (
              <Outlet />
            )}
          </div>

          {requiresVerification && (
            <EmailGateModal
              pageName={meta.title}
              returnTo={currentPath}
              onVerify={handleVerified}
              onClose={handleCloseGate}
            />
          )}
        </div>
      </div>
    </HelpProvider>
  );
}
