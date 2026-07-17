import {
  Content,
  Header,
  HeaderContainer,
  HeaderMenuButton,
  HeaderName,
  SideNav,
  SideNavItems,
  SideNavLink,
  SkipToContent,
} from '@carbon/react';
import { useEffect, useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import Account from './components/Account';
import Toasts from './components/Toasts';
import AllTools from './pages/AllTools';
import Overview from './pages/Overview';
import RecentCalls from './pages/RecentCalls';
import ServerDetail from './pages/ServerDetail';
import Servers from './pages/Servers';
import ToolUsage from './pages/ToolUsage';
import Users from './pages/Users';

const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/tools', label: 'Tool Usage' },
  { to: '/servers', label: 'MCP Servers' },
  { to: '/all-tools', label: 'All Tools' },
  { to: '/users', label: 'Users' },
  { to: '/calls', label: 'Recent Calls' },
];

export default function App() {
  const { pathname } = useLocation();
  // Link back to the platform home page; its URL is provided by the server (HOME_URL env, default "/").
  const [homeUrl, setHomeUrl] = useState('/');
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}config.json`)
      .then((r) => r.json())
      .then((c: { homeUrl?: string }) => setHomeUrl(c.homeUrl || '/'))
      .catch(() => {});
  }, []);

  return (
    // HeaderContainer owns the "is the nav open?" state and hands it to the menu button and SideNav
    // together, replacing a hardcoded `expanded` that pinned the nav open at EVERY width — and
    // Carbon's `.cds--side-nav--expanded ~ .cds--content { margin-inline-start: 16rem }` then shoved
    // the content 256px right, off the side of a phone.
    <HeaderContainer
      render={({
        isSideNavExpanded,
        onClickSideNavExpand,
      }: {
        isSideNavExpanded: boolean;
        onClickSideNavExpand: () => void;
      }) => (
        <>
          <Toasts />
          <Header aria-label="vMCP Gateway">
            <SkipToContent />
            {/* Carbon shows this only below `lg`, where the nav stops being permanently visible. */}
            <HeaderMenuButton
              aria-label={isSideNavExpanded ? 'Close menu' : 'Open menu'}
              aria-expanded={isSideNavExpanded}
              isActive={isSideNavExpanded}
              onClick={onClickSideNavExpand}
            />
            {/* Top-left, ahead of the product name: the conventional "home" slot, matching the other apps. */}
            <a className="home-link" href={homeUrl} aria-label="Back to home">
              ← Home
            </a>
            <HeaderName href={import.meta.env.BASE_URL} prefix="vMCP">
              Gateway
            </HeaderName>

            {/* Identity, top-right. Same session as the other front ends via one localStorage key. */}
            <Account />

            {/* Rendered INSIDE <Header> on purpose: that earns Carbon's `cds--side-nav--ux` class,
                the whole responsive system — it collapses the nav below `lg` and brings up a
                dismissable overlay. isChildOfHeader={false} would strip the class and opt out of
                responsiveness entirely. */}
            <SideNav
              aria-label="Side navigation"
              expanded={isSideNavExpanded}
              onOverlayClick={onClickSideNavExpand}
              onSideNavBlur={onClickSideNavExpand}
              isPersistent
            >
              <SideNavItems>
                {NAV.map((n) => (
                  <SideNavLink
                    key={n.to}
                    as={Link}
                    to={n.to}
                    isActive={pathname === n.to}
                    // Tapping a link on a phone also dismisses the overlay, else the nav stays draped
                    // over the page you navigated to.
                    onClick={() => {
                      if (isSideNavExpanded) onClickSideNavExpand();
                    }}
                  >
                    {n.label}
                  </SideNavLink>
                ))}
              </SideNavItems>
            </SideNav>
          </Header>

          <Content id="main-content">
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/tools" element={<ToolUsage />} />
              <Route path="/servers" element={<Servers />} />
              <Route path="/servers/:id" element={<ServerDetail />} />
              <Route path="/all-tools" element={<AllTools />} />
              <Route path="/users" element={<Users />} />
              <Route path="/calls" element={<RecentCalls />} />
            </Routes>
          </Content>
        </>
      )}
    />
  );
}
