import React from "react";
/* Hatch — Lucide-style icon set. Exported to Icons. */
function LucideIcon({ children, size = 16, className = "", strokeWidth = 1.75, fill = "none" }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill={fill} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round"
      strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

const Icons = {
  Lock: (p) => <LucideIcon {...p}><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></LucideIcon>,
  Key: (p) => <LucideIcon {...p}><circle cx="7.5" cy="15.5" r="5.5" /><path d="M21 2l-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></LucideIcon>,
  MailOpen: (p) => <LucideIcon {...p}><path d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0Z" /><path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10" /></LucideIcon>,
  CheckCircle2: (p) => <LucideIcon {...p}><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></LucideIcon>,
  Clock: (p) => <LucideIcon {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></LucideIcon>,
  AlertTriangle: (p) => <LucideIcon {...p}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></LucideIcon>,
  XCircle: (p) => <LucideIcon {...p}><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></LucideIcon>,
  CalendarClock: (p) => <LucideIcon {...p}><path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4.5" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /><circle cx="17" cy="16" r="5" /><path d="M17 14v2l1.5 1" /></LucideIcon>,
  Shield: (p) => <LucideIcon {...p}><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z" /></LucideIcon>,
  LineChart: (p) => <LucideIcon {...p}><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="m19 9-5 5-4-4-3 3" /></LucideIcon>,
  GitBranch: (p) => <LucideIcon {...p}><line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></LucideIcon>,
  Wallet: (p) => <LucideIcon {...p}><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" /><path d="M16 12h5v-2a2 2 0 0 0-2-2h-3a2 2 0 0 0 0 4Z" /></LucideIcon>,
  ChevronDown: (p) => <LucideIcon {...p}><path d="m6 9 6 6 6-6" /></LucideIcon>,
  Check: (p) => <LucideIcon {...p}><path d="M20 6 9 17l-5-5" /></LucideIcon>,
  ArrowRight: (p) => <LucideIcon {...p}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></LucideIcon>,
  Sun: (p) => <LucideIcon {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></LucideIcon>,
  Moon: (p) => <LucideIcon {...p}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></LucideIcon>,
  Plus: (p) => <LucideIcon {...p}><path d="M5 12h14" /><path d="M12 5v14" /></LucideIcon>,
  Copy: (p) => <LucideIcon {...p}><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></LucideIcon>,
  ExternalLink: (p) => <LucideIcon {...p}><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></LucideIcon>,
  MoreHorizontal: (p) => <LucideIcon {...p} fill="currentColor" strokeWidth="0"><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /><circle cx="5" cy="12" r="1.4" /></LucideIcon>,
  CalendarDays: (p) => <LucideIcon {...p}><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></LucideIcon>,
  ArrowDown: (p) => <LucideIcon {...p}><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></LucideIcon>,
  Users: (p) => <LucideIcon {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></LucideIcon>,
  Eye: (p) => <LucideIcon {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></LucideIcon>,
  EyeOff: (p) => <LucideIcon {...p}><path d="M10.7 5.1A9.6 9.6 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.4" /><path d="M6.6 6.6A13.1 13.1 0 0 0 2 12s3.5 7 10 7a9.3 9.3 0 0 0 5.4-1.6" /><path d="m2 2 20 20" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></LucideIcon>,
  Flame: (p) => <LucideIcon {...p}><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z" /></LucideIcon>,
  Fingerprint: (p) => <LucideIcon {...p}><path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4" /><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" /><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" /><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" /><path d="M8.65 22c.21-.66.45-1.32.57-2" /><path d="M14 13.12c0 2.38 0 6.38-1 8.88" /><path d="M2 16h.01" /><path d="M21.8 16c.2-2 .131-5.354 0-6" /><path d="M9 6.8a6 6 0 0 1 9 5.2v2" /></LucideIcon>,
  Timer: (p) => <LucideIcon {...p}><line x1="10" x2="14" y1="2" y2="2" /><line x1="12" x2="15" y1="14" y2="11" /><circle cx="12" cy="14" r="8" /></LucideIcon>,
  Hash: (p) => <LucideIcon {...p}><line x1="4" x2="20" y1="9" y2="9" /><line x1="4" x2="20" y1="15" y2="15" /><line x1="10" x2="8" y1="3" y2="21" /><line x1="16" x2="14" y1="3" y2="21" /></LucideIcon>,
  Infinity: (p) => <LucideIcon {...p}><path d="M12 12c-2-2.67-4-4-6-4a4 4 0 1 0 0 8c2 0 4-1.33 6-4Zm0 0c2 2.67 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.33-6 4Z" /></LucideIcon>,
  Activity: (p) => <LucideIcon {...p}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></LucideIcon>,
  Feather: (p) => <LucideIcon {...p}><path d="M12.67 19a2 2 0 0 0 1.42-.59l6.92-6.92a2.3 2.3 0 0 0 0-3.26l-3.24-3.24a2.3 2.3 0 0 0-3.26 0L7.59 9.91A2 2 0 0 0 7 11.33Z" /><path d="M16 8 2 22" /><path d="M17.5 15H9" /></LucideIcon>,
  Coins: (p) => <LucideIcon {...p}><circle cx="8" cy="8" r="6" /><path d="M18.09 10.37A6 6 0 1 1 10.34 18" /><path d="M7 6h1v4" /><path d="m16.71 13.88.7.71-2.82 2.82" /></LucideIcon>,
  ArrowUpRight: (p) => <LucideIcon {...p}><path d="M7 7h10v10" /><path d="M7 17 17 7" /></LucideIcon>,
  Bell: (p) => <LucideIcon {...p}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></LucideIcon>,
  UserPlus: (p) => <LucideIcon {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" x2="19" y1="8" y2="14" /><line x1="22" x2="16" y1="11" y2="11" /></LucideIcon>,
  BookOpen: (p) => <LucideIcon {...p}><path d="M12 7v14" /><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3Z" /></LucideIcon>,
  TrendingUp: (p) => <LucideIcon {...p}><path d="M16 7h6v6" /><path d="m22 7-8.5 8.5-5-5L2 17" /></LucideIcon>,
  Radio: (p) => <LucideIcon {...p}><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" /><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" /><circle cx="12" cy="12" r="2" /><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" /><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" /></LucideIcon>,
  ArrowLeft: (p) => <LucideIcon {...p}><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></LucideIcon>,
  Menu: (p) => <LucideIcon {...p}><line x1="4" x2="20" y1="6" y2="6" /><line x1="4" x2="20" y1="12" y2="12" /><line x1="4" x2="20" y1="18" y2="18" /></LucideIcon>,
};
export { Icons };
export { LucideIcon };