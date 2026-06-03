// Design components were ported from a Babel-standalone prototype. Vite handles
// the .jsx transform; TS sees them as untyped modules. Wildcard-declare them
// using an `any` namespace so named imports succeed without explicit types.
// Iteration 3 ports these to .tsx with proper types.
declare module "*.jsx" {
  const _anyExport: any;
  // Allow any named export to come through as `any` — typical for legacy JSX bridges.
  export { _anyExport as App };
  export { _anyExport as ConsoleApp };
  export { _anyExport as Atmosphere };
  export { _anyExport as Header };
  export { _anyExport as Hero };
  export { _anyExport as Manifesto };
  export { _anyExport as Lifecycle };
  export { _anyExport as LiveProof };
  export { _anyExport as Trust };
  export { _anyExport as Closing };
  export { _anyExport as Footer };
  export { _anyExport as Rail };
  export { _anyExport as TopBar };
  export { _anyExport as useRoute };
  export { _anyExport as HatchDetail };
  export { _anyExport as Publisher };
  export { _anyExport as TrackRecord };
  export { _anyExport as Queue };
  export { _anyExport as Timeline };
  export { _anyExport as Icons };
  export { _anyExport as Avatar };
  export { _anyExport as Tag };
  export { _anyExport as Button };
  export { _anyExport as Reveal };
  export { _anyExport as StatusPill };
  export { _anyExport as TrackRecordBadge };
  export { _anyExport as WaxSealCracked };
  export { _anyExport as HatchObject };
  export { _anyExport as BigCountdown };
  export { _anyExport as Curve };
  export { _anyExport as HatchOrb };
  export { _anyExport as OrbPip };
  export { _anyExport as stateFromMs };
  export { _anyExport as useInView };
  export { _anyExport as useCountUp };
  export { _anyExport as LucideIcon };
  export default _anyExport;
}
