"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  LayoutDashboard, Siren, MapPinned, Tent, ClipboardList, Warehouse, Boxes, PackageCheck, Truck, Bus, Users, HeartHandshake,
  FileWarning, BarChart3, Brain, Map as MapIcon, Database, GitBranch, Sigma, Table2, Gauge, Layers, ArrowLeftRight, Leaf,
  KeyRound, Share2, Sparkles, Workflow, Shield, ScrollText, Tags, Package, LogOut, PanelLeftClose, PanelLeftOpen, Menu, History, BookOpen,
} from "lucide-react";
import { ConfirmProvider, ToastProvider } from "@/components/ui/overlays";
import { api } from "@/lib/client";

export type Me = { user_id: string; full_name: string; role_name: "ADMIN" | "RELIEF_COORDINATOR" | "FIELD_OFFICER" | "DRIVER"; email?: string };
const MeCtx = createContext<Me | null>(null);
export const useMe = () => useContext(MeCtx);
export const isManager = (me: Me | null) => me?.role_name === "ADMIN" || me?.role_name === "RELIEF_COORDINATOR";

type Item = { href: string; label: string; icon: ReactNode; roles?: Me["role_name"][] };
const staff: Me["role_name"][] = ["ADMIN", "RELIEF_COORDINATOR", "FIELD_OFFICER"];
const mgr: Me["role_name"][] = ["ADMIN", "RELIEF_COORDINATOR"];
const groups: { title: string; items: Item[] }[] = [
  { title: "Overview", items: [
    { href: "/", label: "Command Center", icon: <LayoutDashboard size={17} />, roles: staff },
    { href: "/map", label: "Operations Map", icon: <MapIcon size={17} />, roles: staff },
  ] },
  { title: "Disaster Operations", items: [
    { href: "/disasters", label: "Disasters", icon: <Siren size={17} />, roles: staff },
    { href: "/manage/camps", label: "Relief Camps", icon: <Tent size={17} />, roles: staff },
    { href: "/requests", label: "Resource Requests", icon: <ClipboardList size={17} />, roles: staff },
    { href: "/incidents", label: "Incident Reports", icon: <FileWarning size={17} />, roles: staff },
  ] },
  { title: "Resource Management", items: [
    { href: "/manage/warehouses", label: "Warehouses", icon: <Warehouse size={17} />, roles: staff },
    { href: "/manage/inventory", label: "Inventory", icon: <Boxes size={17} />, roles: staff },
    { href: "/manage/resources", label: "Resources", icon: <Package size={17} />, roles: staff },
    { href: "/manage/categories", label: "Categories", icon: <Tags size={17} />, roles: staff },
  ] },
  { title: "Logistics", items: [
    { href: "/manage/allocations", label: "Allocations", icon: <PackageCheck size={17} />, roles: staff },
    { href: "/manage/deliveries", label: "Deliveries", icon: <Truck size={17} /> },
    { href: "/manage/vehicles", label: "Vehicles", icon: <Bus size={17} />, roles: staff },
    { href: "/manage/volunteers", label: "Volunteers", icon: <HeartHandshake size={17} />, roles: staff },
  ] },
  { title: "Analytics", items: [
    { href: "/intelligence", label: "Demand Intelligence", icon: <Brain size={17} />, roles: staff },
    { href: "/analytics", label: "Analytics", icon: <BarChart3 size={17} />, roles: staff },
  ] },
  { title: "Database Engineering Lab", items: [
    { href: "/lab", label: "Lab Overview", icon: <Database size={17} /> },
    { href: "/lab/concepts", label: "DBMS Concepts", icon: <BookOpen size={17} /> },
    { href: "/lab/er", label: "ER Explorer", icon: <GitBranch size={17} /> },
    { href: "/lab/algebra", label: "Relational Algebra", icon: <Sigma size={17} /> },
    { href: "/lab/sql", label: "SQL Explorer", icon: <Table2 size={17} /> },
    { href: "/lab/advanced", label: "Advanced SQL", icon: <Layers size={17} /> },
    { href: "/lab/optimization", label: "Query Optimisation", icon: <Gauge size={17} /> },
    { href: "/lab/normalization", label: "Normalisation", icon: <Workflow size={17} /> },
    { href: "/lab/transactions", label: "Transactions", icon: <ArrowLeftRight size={17} /> },
    { href: "/lab/security", label: "Security & RBAC", icon: <Shield size={17} /> },
    { href: "/lab/nosql", label: "MongoDB & NoSQL", icon: <Leaf size={17} /> },
    { href: "/lab/keyvalue", label: "Key-Value (Redis)", icon: <KeyRound size={17} /> },
    { href: "/lab/graph", label: "Graph (Neo4j)", icon: <Share2 size={17} /> },
    { href: "/lab/vector", label: "Vector Search", icon: <Sparkles size={17} /> },
    { href: "/lab/integration", label: "Next.js ↔ SQL", icon: <MapPinned size={17} /> },
  ] },
  { title: "Administration", items: [
    { href: "/manage/users", label: "Users", icon: <Shield size={17} />, roles: ["ADMIN"] },
    { href: "/manage/locations", label: "Locations", icon: <MapPinned size={17} />, roles: staff },
    { href: "/manage/audit", label: "Audit Log", icon: <ScrollText size={17} />, roles: mgr },
    { href: "/manage/changes", label: "Data Change Log", icon: <History size={17} />, roles: mgr },
    { href: "/manage/movements", label: "Stock Movements", icon: <Users size={17} />, roles: staff },
  ] },
];
const allItems = groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.title })));

function activeFor(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || (href !== "/lab" && path.startsWith(href + "/")) || (href === "/lab" && path === "/lab");
}

type Health = { status: string; services: Record<string, { ok: boolean; configured?: boolean; required: boolean }> };

export default function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const reduce = useReducedMotion();
  const [me, setMe] = useState<Me | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const isLogin = path === "/login";

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("rf.sidebar") === "collapsed");
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => {
    if (isLogin) return;
    api<Me>("/api/auth")
      .then((u) => {
        setMe(u);
        if (u.role_name === "DRIVER" && !path.startsWith("/manage/deliveries") && !path.startsWith("/lab")) router.replace("/manage/deliveries");
      })
      .catch(() => undefined);
  }, [isLogin, path, router]);
  useEffect(() => {
    if (isLogin) return;
    const load = () => fetch("/api/health", { cache: "no-store" }).then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [isLogin]);
  useEffect(() => setMobile(false), [path]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("rf.sidebar", c ? "open" : "collapsed");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  if (isLogin)
    return (
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    );

  const current = allItems.find((i) => activeFor(path, i.href));
  const visible = (i: Item) => !i.roles || (me && i.roles.includes(me.role_name));
  const initials = me?.full_name?.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() ?? "··";
  const svc = health?.services ?? {};
  const dot = (k: string) => (!svc[k] ? "" : svc[k].ok ? "ok" : svc[k].configured === false ? "off" : svc[k].required ? "bad" : "off");

  return (
    <MeCtx.Provider value={me}>
      <ToastProvider>
        <ConfirmProvider>
          <a href="#main" className="skip-link">
            Skip to content
          </a>
          <div className={`app ${collapsed ? "collapsed" : ""} ${mobile ? "mobile-open" : ""}`}>
            <aside className="sidebar" aria-label="Primary">
              <div className="brand">
                <div className="brand-mark" aria-hidden>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12h4l3-8 4 16 3-8h4" />
                  </svg>
                </div>
                {!collapsed && (
                  <div>
                    <div className="brand-name">
                      Relief<span>Flow</span>
                    </div>
                    <div className="brand-sub">Disaster response platform</div>
                  </div>
                )}
              </div>
              <nav className="nav" aria-label="Main navigation">
                {groups.map((g) => {
                  const items = g.items.filter(visible);
                  if (!items.length) return null;
                  return (
                    <div className="nav-group" key={g.title}>
                      <div className="nav-group-title">{g.title}</div>
                      {items.map((i) => {
                        const active = activeFor(path, i.href);
                        return (
                          <Link key={i.href} href={i.href} className={`nav-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} data-tip={collapsed ? i.label : undefined} aria-label={collapsed ? i.label : undefined}>
                            {i.icon}
                            <span className="nav-label">{i.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  );
                })}
              </nav>
              <div className="sidebar-footer">
                <button className="collapse-btn" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed}>
                  {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
                  {!collapsed && <span>Collapse</span>}
                </button>
              </div>
            </aside>
            <div className="scrim" onClick={() => setMobile(false)} aria-hidden />
            <div className="content">
              <header className="topbar">
                <button className="btn ghost icon menu-btn" aria-label="Open navigation" aria-expanded={mobile} onClick={() => setMobile(true)}>
                  <Menu size={18} />
                </button>
                <div className="crumbs">
                  <span>{current?.group ?? "ReliefFlow"}</span>
                  <span aria-hidden>/</span>
                  <b>{current?.label ?? "Page"}</b>
                </div>
                <div className="topbar-right">
                  {health && (
                    <Link href="/lab" className="service-dots" title="Service health" aria-label={`System ${health.status}`}>
                      {["postgres", "mongodb", "redis", "neo4j", "vector"].map((k) => (
                        <span key={k} className="row" style={{ gap: 4 }}>
                          <i className={`dot ${dot(k)}`} aria-hidden />
                          <span>{{ postgres: "PG", mongodb: "Mongo", redis: "Redis", neo4j: "Neo4j", vector: "Vector" }[k]}</span>
                        </span>
                      ))}
                    </Link>
                  )}
                  <div className="user-chip">
                    <div className="avatar" aria-hidden>
                      {initials}
                    </div>
                    <div className="user-meta">
                      <b>{me?.full_name ?? "Loading…"}</b>
                      <small>{me?.role_name?.replaceAll("_", " ").toLowerCase()}</small>
                    </div>
                  </div>
                  <button
                    className="btn ghost sm"
                    onClick={async () => {
                      await fetch("/api/auth", { method: "DELETE" });
                      location.href = "/login";
                    }}
                  >
                    <LogOut size={15} /> Sign out
                  </button>
                </div>
              </header>
              <AnimatePresence mode="wait">
                <motion.main
                  id="main"
                  key={path}
                  className="page"
                  initial={reduce ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? undefined : { opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  {children}
                </motion.main>
              </AnimatePresence>
            </div>
          </div>
        </ConfirmProvider>
      </ToastProvider>
    </MeCtx.Provider>
  );
}
