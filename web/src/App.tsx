import { useEffect, useState } from "react";
import {
  Content,
  Header,
  HeaderName,
  SideNav,
  SideNavItems,
  SideNavLink,
} from "@carbon/react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import Overview from "./pages/Overview";
import ToolUsage from "./pages/ToolUsage";
import Servers from "./pages/Servers";
import ServerDetail from "./pages/ServerDetail";
import AllTools from "./pages/AllTools";
import Users from "./pages/Users";
import RecentCalls from "./pages/RecentCalls";

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
    <>
      <Header aria-label="vMCP Gateway">
        {/* Top-left corner, ahead of the product name: the conventional place for "home", and the
            same slot the other apps behind the proxy use. The Header is outside <Routes>, so this
            renders on every page — including a server's detail page. */}
        <a className="home-link" href={homeUrl} aria-label="Back to home">
          ← Home
        </a>
        <HeaderName href={import.meta.env.BASE_URL} prefix="vMCP">
          Gateway
        </HeaderName>
      </Header>

      <SideNav aria-label="Side navigation" isFixedNav expanded isChildOfHeader={false}>
        <SideNavItems>
          {NAV.map((n) => (
            <SideNavLink
              key={n.to}
              as={Link}
              to={n.to}
              isActive={pathname === n.to}
            >
              {n.label}
            </SideNavLink>
          ))}
        </SideNavItems>
      </SideNav>

      <Content>
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
  );
}
