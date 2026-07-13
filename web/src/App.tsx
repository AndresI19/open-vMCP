import { useEffect, useState } from "react";
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
} from "@carbon/react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import Overview from "./pages/Overview";
import ToolUsage from "./pages/ToolUsage";
import Servers from "./pages/Servers";
import ServerDetail from "./pages/ServerDetail";
import AllTools from "./pages/AllTools";
import Users from "./pages/Users";
import RecentCalls from "./pages/RecentCalls";
import Account from "./components/Account";
import Toasts from "./components/Toasts";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/tools", label: "Tool Usage" },
  { to: "/servers", label: "MCP Servers" },
  { to: "/all-tools", label: "All Tools" },
  { to: "/users", label: "Users" },
  { to: "/calls", label: "Recent Calls" },
];

export default function App() {
  const { pathname } = useLocation();
  // Link back to the platform home page; its URL is provided by the server (HOME_URL env, default "/").
  const [homeUrl, setHomeUrl] = useState("/");
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}config.json`)
      .then((r) => r.json())
      .then((c: { homeUrl?: string }) => setHomeUrl(c.homeUrl || "/"))
      .catch(() => {});
  }, []);

  return (
    // Toasts render above everything; HeaderContainer owns the "is the nav open?" state and hands it to the menu button and the
    // SideNav together. It replaces a hardcoded `expanded`, which was the bug: the nav was pinned
    // open at EVERY width, and Carbon's rule
    //     .cds--side-nav--expanded ~ .cds--content { margin-inline-start: 16rem }
    // then shoved the content 256px to the right — off the side of a phone.
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
            {/* Carbon shows this only below its `lg` breakpoint, so the hamburger appears exactly
                where the nav stops being permanently visible. */}
            <HeaderMenuButton
              aria-label={isSideNavExpanded ? "Close menu" : "Open menu"}
              aria-expanded={isSideNavExpanded}
              isActive={isSideNavExpanded}
              onClick={onClickSideNavExpand}
            />
            {/* Top-left corner, ahead of the product name: the conventional place for "home", and the
                same slot the other apps behind the proxy use. */}
            <a className="home-link" href={homeUrl} aria-label="Back to home">
              ← Home
            </a>
            <HeaderName href={import.meta.env.BASE_URL} prefix="vMCP">
              Gateway
            </HeaderName>

            {/* Identity, top-right. The same session as the other front ends: they all read one
                localStorage key, so signing in on the quiz signs you in here. */}
            <Account />

            {/* Rendered INSIDE <Header> on purpose. That is what makes it a child of the header, which
                is what earns it Carbon's `cds--side-nav--ux` class — and that class is the whole
                responsive system: it collapses the nav to zero width below `lg` and brings up a
                dismissable overlay instead. The previous code passed isChildOfHeader={false}, which
                stripped the class and opted the dashboard out of responsiveness entirely. */}
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
                    // Tapping a link on a phone should also dismiss the overlay it was tapped in;
                    // otherwise the nav stays draped over the page you just navigated to.
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
