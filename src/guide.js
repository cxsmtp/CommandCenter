/**
 * The RW report: the POV guide as one interactive page (overview, the customer's toolchain, the platform
 * components with the criteria that test them, the plan and timeline with its approval gates, the team and
 * environment, and the test plan: business goals with their success criteria, numbered 1.1, 1.2…, with milestones,
 * the customer's tracker references and their status).
 *
 * Everything comes from the POV; what is not known yet shows as "To confirm", to agree at kickoff. The criteria are
 * the ones the SEAL business goals brought (or the bank as an Admin edited it).
 */
import { TOOLCHAIN, PLAN_DEFAULTS, DEVSECOPS } from './toolchain.js';

const CSS = "\n:root{\n  --violet:#6B34FD; --midnight:#140921; --white:#FCF9FE; --orange:#F25929; --magenta:#A822BF; --blue:#006BD5;\n  --bg:#FCF9FE; --surface:#FFFFFF; --surface-2:#F3EEFE; --text:#140921; --muted:#5B5266; --line:#E2D9F7;\n  --accent:var(--violet); --tbd-bg:#FFF1EC; --tbd-text:#B23A12;\n  --font:\"Aptos\",\"Helvetica\",\"Arial\",sans-serif;\n  box-sizing:border-box; padding-top:env(safe-area-inset-top,0px); padding-bottom:env(safe-area-inset-bottom,0px);\n}\n@media (prefers-color-scheme: dark){\n  :root:not([data-theme=\"light\"]){\n    --bg:#140921; --surface:#1D1130; --surface-2:#26173F; --text:#FCF9FE; --muted:#B9AECB; --line:#3A2A57;\n    --accent:#9C7BFF; --tbd-bg:#3A1A12; --tbd-text:#FF9B7A;\n  }\n}\n:root[data-theme=\"dark\"]{\n  --bg:#140921; --surface:#1D1130; --surface-2:#26173F; --text:#FCF9FE; --muted:#B9AECB; --line:#3A2A57;\n  --accent:#9C7BFF; --tbd-bg:#3A1A12; --tbd-text:#FF9B7A;\n}\n*,*::before,*::after{box-sizing:inherit}\nhtml{scroll-padding-top:calc(env(safe-area-inset-top,0px) + 72px);scroll-behavior:smooth}\n@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}}\nbody{margin:0;background:var(--bg);color:var(--text);font-family:var(--font);font-size:16px;line-height:1.5}\na{color:var(--accent)}\nbutton{font:inherit;color:inherit}\n:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\n.logo{height:16px;width:auto;display:block}\n\n/* Top bar */\n.topbar{position:sticky;top:env(safe-area-inset-top,0px);z-index:20;display:flex;align-items:center;gap:16px;\n  padding:12px clamp(16px,4vw,32px);background:var(--bg);border-bottom:1px solid var(--line)}\n.topbar .logo{color:var(--violet)}\n:root[data-theme=\"dark\"] .topbar .logo{color:var(--white)}\n@media (prefers-color-scheme: dark){:root:not([data-theme=\"light\"]) .topbar .logo{color:var(--white)}}\n.topbar .doc{font-weight:600;font-size:14px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.topbar .spacer{flex:1}\n.seg{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:2px;background:var(--surface)}\n.seg button{border:0;background:transparent;padding:5px 12px;border-radius:999px;font-size:13px;cursor:pointer;color:var(--muted);white-space:nowrap}\n.seg button[aria-pressed=\"true\"]{background:var(--violet);color:#fff}\n.iconbtn{white-space:nowrap;border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:5px 12px;font-size:13px;cursor:pointer;color:var(--muted)}\n\n/* Layout */\n.wrap{display:grid;grid-template-columns:220px minmax(0,1fr);gap:40px;max-width:1240px;margin:0 auto;padding:0 clamp(16px,4vw,32px)}\nnav.toc{position:sticky;top:calc(env(safe-area-inset-top,0px) + 72px);align-self:start;padding:32px 0;font-size:14px}\nnav.toc ol{list-style:none;margin:0;padding:0;border-left:2px solid var(--line)}\nnav.toc a{display:block;padding:6px 14px;color:var(--muted);text-decoration:none;margin-left:-2px;border-left:2px solid transparent}\nnav.toc a.active{color:var(--text);border-left-color:var(--violet);font-weight:600}\nmain{min-width:0;padding-bottom:64px}\n@media (max-width:900px){.wrap{grid-template-columns:1fr;gap:0} nav.toc{display:none} .topbar .doc{display:none}}\n\nsection{padding:48px 0 8px;border-bottom:1px solid var(--line)}\nsection:last-of-type{border-bottom:0}\n.eyebrow{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin:0 0 8px}\nh2{font-size:clamp(26px,3.2vw,34px);line-height:1.15;margin:0 0 10px}\nh3{font-size:20px;margin:0 0 6px}\nh4{font-size:15px;margin:0 0 8px}\n.lede{font-size:18px;color:var(--muted);max-width:68ch;margin:0 0 28px}\np{max-width:72ch}\n\n/* Placeholders */\n.tbd{display:inline;padding:1px 8px;line-height:1.9;-webkit-box-decoration-break:clone;box-decoration-break:clone;border-radius:6px;border:1px dashed var(--orange);\n  background:var(--tbd-bg);color:var(--tbd-text);font-size:.9em;font-weight:600;cursor:default}\n.tbd::before{content:\"To confirm: \";font-weight:400;opacity:.85}\n.tbd.kick::before{content:\"Agree at kickoff:\"}\n\n\n/* Cover */\n.cover{margin-top:24px;border-radius:14px;overflow:hidden;contain:paint;color:var(--white);\n  background:radial-gradient(120% 140% at 85% 20%,#3B1C8C 0%,#1E0F3A 45%,#140921 75%);position:relative;padding:clamp(28px,5vw,56px)}\n.cover .logo{color:var(--white);height:20px;margin-bottom:56px}\n.cover .customer{font-size:clamp(18px,2vw,22px);color:#D9CCFF;margin:0 0 6px}\n.cover h1{font-size:clamp(34px,5vw,56px);line-height:1.05;margin:0 0 18px;max-width:16ch}\n.cover p{color:#E6DDFB;font-size:18px;max-width:58ch;margin:0 0 28px}\n.cover .facts{display:flex;flex-wrap:wrap;gap:10px 28px;font-size:14px;color:#CFC3F0;align-items:center}\n.cover .facts b{color:var(--white);font-weight:600}\n.cover .tbd{background:rgba(242,89,41,.14);color:#FFB49A}\n.cover .mark{position:absolute;right:-60px;top:-40px;width:340px;opacity:.10;color:#fff;pointer-events:none}\n.cover .callout{margin-top:28px;font-size:13px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--orange)}\n\n/* Goals strip */\n.goals{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:28px 0 8px}\n@media (max-width:1100px){.goals{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}}\n.goal-chip{display:block;text-decoration:none;color:inherit;padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}\n.goal-chip:hover{border-color:var(--violet)}\n.goal-chip .n{font-size:13px;color:var(--accent);font-weight:700}\n.goal-chip .t{display:block;font-weight:600;line-height:1.3;margin-top:4px}\n\n/* SDLC */\n.phases{display:flex;flex-wrap:wrap;gap:0;margin:0 0 20px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--surface)}\n.phases span{flex:1 1 90px;text-align:center;padding:10px 6px;font-size:14px;font-weight:600;border-right:1px solid var(--line);color:var(--muted)}\n.phases span:last-child{border-right:0}\n.phases span.on{color:var(--text);background:var(--surface-2)}\n.tools{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}\n.tool{border:1px solid var(--line);border-radius:10px;padding:14px;background:var(--surface)}\n.tool h4{display:flex;justify-content:space-between;gap:8px}\n.tool h4 small{font-weight:400;color:var(--muted);font-size:12px}\n.tool ul{margin:0;padding-left:18px}\n.tool li{margin:3px 0}\n.rule{margin-top:16px;padding:12px 14px;border-radius:8px;border:1px solid var(--line);background:var(--surface);font-size:14px}\n.rule b{color:var(--accent)}\n\n/* Platform map */\n.legend{display:flex;gap:18px;flex-wrap:wrap;font-size:13px;color:var(--muted);margin:0 0 14px}\n.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-1px;margin-right:6px}\n.legend .in{background:var(--violet)} .legend .out{border:1px dashed var(--muted)}\n.pmap{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:10px}\n.prow{display:grid;grid-template-columns:170px 1fr;gap:12px;align-items:start;padding:10px;border-bottom:1px solid var(--line)}\n.prow:last-child{border-bottom:0}\n.prow .g{font-weight:700;font-size:14px;padding-top:7px}\n.pitems{display:flex;flex-wrap:wrap;gap:8px}\n.comp{border:1px solid var(--violet);background:var(--violet);color:#fff;border-radius:8px;padding:6px 10px;font-size:14px;cursor:pointer;text-align:left;line-height:1.3}\n.comp .c{display:inline-block;margin-left:6px;padding:0 6px;border-radius:999px;background:rgba(255,255,255,.22);font-size:12px}\n.comp.out{background:transparent;color:var(--muted);border:1px dashed var(--line);cursor:default}\n.comp[aria-pressed=\"true\"]{outline:2px solid var(--orange);outline-offset:2px}\n@media (max-width:640px){.prow{grid-template-columns:1fr}.prow .g{padding-top:0}}\n.flow{margin-top:24px;border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:18px}\n.flow ol{list-style:none;margin:12px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;counter-reset:f}\n.flow li{counter-increment:f;padding:12px;border-radius:8px;background:var(--surface-2);font-size:14px}\n.flow li b{display:block;margin-bottom:2px}\n.flow li b::before{content:counter(f) \". \";color:var(--accent)}\n.flow .engines{margin-top:12px;font-size:14px;color:var(--muted)}\n\n/* Plan */\n.three{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px}\n.card{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:18px}\n.card .sub{color:var(--muted);margin:0 0 10px;font-size:14px}\n.card ul{margin:0;padding-left:18px}\n.card li{margin:5px 0}\n.timeline{list-style:none;margin:28px 0 0;padding:0;position:relative}\n.timeline::before{content:\"\";position:absolute;left:15px;top:6px;bottom:6px;width:2px;background:var(--line)}\n.timeline li{position:relative;padding:0 0 18px 48px}\n.timeline .dot{position:absolute;left:4px;top:0;width:24px;height:24px;border-radius:50%;background:var(--violet);color:#fff;font-size:12px;font-weight:700;display:grid;place-items:center}\n.timeline li.gate .dot{background:var(--surface);border:2px solid var(--magenta);color:var(--magenta)}\n.timeline .when{font-size:14px;margin-top:2px}\n.timeline .what{color:var(--muted);font-size:14px;margin-top:2px}\n\n/* Tables */\n.tbl{width:100%;border-collapse:collapse;font-size:14px;background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden}\n.tblwrap{overflow-x:auto;border-radius:10px;margin:0 0 20px}\n.tbl th{text-align:left;font-weight:700;padding:10px 12px;background:var(--surface-2);border-bottom:1px solid var(--line);white-space:nowrap}\n.tbl td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}\n.tbl tr:last-child td{border-bottom:0}\n.tbl .grp td{background:var(--bg);font-weight:700;font-size:13px;color:var(--accent)}\n.two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.4fr);gap:20px}\n@media (max-width:900px){.two{grid-template-columns:1fr}}\n\n/* Test plan */\n.filters{display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;margin:0 0 18px;font-size:14px}\n.filters label{color:var(--muted)}\n.filters select{max-width:min(100%,340px);font:inherit;padding:5px 8px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--text)}\n.activefilter{display:none;align-items:center;gap:8px;padding:4px 6px 4px 12px;border-radius:999px;background:var(--surface-2);border:1px solid var(--orange)}\n.activefilter.on{display:inline-flex}\n.activefilter button{border:0;background:var(--orange);color:#fff;border-radius:999px;padding:2px 9px;cursor:pointer;font-size:12px}\n.goal{border:1px solid var(--line);border-radius:12px;background:var(--surface);margin:0 0 18px;overflow:hidden}\n.goal-head{display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:start;padding:18px;border-bottom:1px solid var(--line)}\n.goal-head .num{width:36px;height:36px;border-radius:8px;background:var(--violet);color:#fff;display:grid;place-items:center;font-weight:700}\n.goal-head p{margin:4px 0 0;color:var(--muted);font-size:15px}\n.goal-head .meta{font-size:13px;color:var(--muted);margin-top:8px}\n.goal-head button{border:1px solid var(--line);background:var(--bg);border-radius:8px;padding:5px 10px;font-size:13px;cursor:pointer;color:var(--muted)}\n.goal.collapsed .goal-body{display:none}\n.crit{display:grid;grid-template-columns:200px minmax(0,1.3fr) minmax(0,1fr);gap:16px;padding:16px 18px;border-bottom:1px solid var(--line)}\n.crit:last-of-type{border-bottom:0}\n.crit .id{font-size:13px;color:var(--accent);font-weight:700}\n.crit .name{font-weight:700;line-height:1.3;margin:2px 0 8px}\n.crit .lbl{font-size:12px;font-weight:700;color:var(--muted);margin:0 0 3px}\n.crit .test,.crit .ben{font-size:15px}\n.tags{display:flex;flex-wrap:wrap;gap:6px}\n.tag{font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}\n.tag.m{color:var(--blue)}\n:root[data-theme=\"dark\"] .tag.m{color:#6FB3FF}\n@media (prefers-color-scheme: dark){:root:not([data-theme=\"light\"]) .tag.m{color:#6FB3FF}}\n.tr{font-size:13px;color:var(--muted);margin-top:8px}\n.tr abbr{text-decoration:none;border-bottom:1px dotted var(--muted);cursor:help}\n.crit.hl{background:var(--surface-2)}\n@media (max-width:760px){.crit{grid-template-columns:1fr;gap:10px}}\n.empty{padding:18px;color:var(--muted);font-size:14px}\n\n\nfooter{max-width:1240px;margin:0 auto;padding:28px clamp(16px,4vw,32px) 48px;display:flex;flex-wrap:wrap;gap:12px 32px;align-items:center;justify-content:space-between;font-size:13px;color:var(--muted);border-top:1px solid var(--line)}\nfooter .tag-line{font-size:18px;font-weight:700;color:var(--text)}\n.flash{animation:flash 1.4s ease-out}\n@keyframes flash{from{box-shadow:0 0 0 3px var(--orange)}to{box-shadow:0 0 0 3px transparent}}\n@media (prefers-reduced-motion: reduce){.flash{animation:none}}\n\n@media print{\n  .topbar,nav.toc,.filters,.goal-head button{display:none!important}\n  .wrap{display:block} .goal.collapsed .goal-body{display:block}\n  section{break-inside:avoid-page}\n}\n";
const EXTRA = ".tag.st{border-color:transparent;color:#fff}.tag.st.done,.tag.st.demo{background:#1E9E63}.tag.st.progress{background:#B97A00}.tag.st.planned{background:#C9A100}.tag.st.missed{background:#7A6F86}\n";
const LOGO = "<svg class=\"logo\" viewBox=\"0 0 138.95 18\" role=\"img\" aria-label=\"Checkmarx\" xmlns=\"http://www.w3.org/2000/svg\" fill=\"currentColor\"><path d=\"M137.44,1.18c.45.02.87.23,1.16.58.26.31.38.71.35,1.12-.03.4-.21.77-.49,1.05l-7.71,7.13c-.06.07-.1.17-.1.27s.04.2.11.28l4.21,3.63c.32.31.49.73.5,1.17,0,.46-.17.87-.49,1.17-.15.14-.32.25-.51.32-.18.07-.38.11-.57.11s-.41-.04-.6-.12c-.2-.08-.37-.2-.53-.35l-.02-.02-3.67-4.25c-.14-.13-.4-.13-.55.01l-3.66,4.25c-.16.16-.34.28-.54.36-.37.15-.8.15-1.17,0-.19-.07-.36-.18-.51-.32-.32-.3-.5-.71-.49-1.17,0-.43.18-.86.49-1.16l.02-.02,4.21-3.63c.06-.06.1-.16.1-.27s-.04-.2-.11-.28l-4.21-3.63c-.29-.29-.47-.67-.5-1.06-.03-.41.09-.81.35-1.12.29-.35.71-.56,1.16-.58.45-.02.88.15,1.2.46l.02.02,3.67,4.25c.14.13.41.13.55-.02l7.13-7.72c.31-.31.72-.48,1.14-.48h.07v.02Z\"/><path d=\"M6.31.81c3.94,0,5.84,2.13,6,6.6h-3.25c-.12-2.47-.97-3.61-2.75-3.61-2.09,0-2.92,1.54-2.92,5.58s.78,5.58,2.92,5.58c1.83,0,2.66-1.02,2.8-3.66h3.3c-.19,4.51-2.16,6.64-6.1,6.64C1.92,17.94,0,15.33,0,9.38S1.92.81,6.31.81Z\"/><path fill-rule=\"evenodd\" d=\"M35.23,4.84c4.06,0,5.93,2.18,5.48,7.03h-8.31c.12,2.47,1,3.51,2.85,3.51,1.35,0,2.25-.55,2.47-1.66h2.94c-.28,2.59-2.25,4.08-5.51,4.08-3.87,0-5.91-2.11-5.91-6.48s2.07-6.48,5.98-6.48h.01ZM35.23,7.22c-1.59,0-2.47.83-2.75,2.63h5.29c-.05-1.71-.88-2.63-2.54-2.63Z\"/><path fill-rule=\"evenodd\" d=\"M99.62,4.84c3.42,0,5.06,1.47,5.06,4.51v8.21h-2.47l-.31-1.28h-.69l-.69.69c-.57.57-1.47.83-2.68.83-2.68,0-4.11-1.28-4.11-3.61,0-2.47,1.64-3.77,4.49-3.77h3.25v-.93c0-1.54-.69-2.18-2.11-2.18-1.21,0-2.07.48-2.16,1.64h-2.9c.09-2.59,1.9-4.1,5.32-4.1h0ZM99.03,12.27c-1.35,0-2.04.57-2.04,1.61,0,.92.55,1.52,1.92,1.52,1.64,0,2.56-.85,2.56-2.35v-.78h-2.45.01Z\"/><path d=\"M49.51,4.84c3.56,0,5.44,1.76,5.53,5.01h-3.11c-.14-1.59-.95-2.3-2.42-2.3-1.83,0-2.64,1.09-2.64,3.77s.81,3.77,2.64,3.77c1.49,0,2.33-.71,2.45-2.45h3.16c-.09,3.37-2.02,5.15-5.6,5.15-3.9,0-5.94-2.11-5.94-6.48s2.04-6.48,5.93-6.48h0Z\"/><path d=\"M61.61,9.47h1.45l3.28-4.39h3.66l-4.25,5.82,4.39,6.67h-3.77l-3.35-5.24h-1.4v5.25h-3.2V0h3.2v9.47h-.01Z\"/><path d=\"M87.23,4.84c2.73,0,4.06,1.4,4.06,4.22v8.5h-3.2v-7.64c0-1.54-.67-2.23-2.09-2.23-1.51,0-2.27.75-2.28,2.21l-.03-.03v7.69h-3.2v-7.64c0-1.54-.66-2.23-2.09-2.23-1.52,0-2.28.76-2.28,2.23v7.64h-3.21V5.08h2.37l.33,1.28h.69l.69-.69c.59-.59,1.5-.83,2.63-.83,1.64,0,2.77.51,3.42,1.52h.86l.69-.69c.59-.59,1.5-.83,2.63-.83h0Z\"/><path d=\"M18.47,4.15l-.28,2.04.66.17.69-.69c.59-.59,1.43-.83,2.54-.83,2.68,0,3.96,1.4,3.96,4.22v8.5h-3.2v-7.64c0-1.54-.67-2.23-2.09-2.23-1.52,0-2.28.76-2.28,2.23v7.64h-3.2V0h3.2s0,4.15,0,4.15Z\"/><path d=\"M119.88,7.71h-3.16c-1.52,0-2.3.74-2.3,2.09v5.06h3.99v2.7h-10.63v-2.7h3.44v-7.1h-3.04v-2.68h5.34l.31,1.28h.71l.69-.69c.57-.59,1.47-.83,2.64-.83h2.02v2.87h0Z\"/></svg>";
const MARK = "<svg class=\"mark\" viewBox=\"0 0 16.8 16.85\" aria-hidden=\"true\" fill=\"currentColor\"><path d=\"M15.29.03c.45.02.87.23,1.16.58.26.31.38.71.35,1.12-.03.4-.21.77-.49,1.05l-7.71,7.13c-.06.07-.1.17-.1.27s.04.2.11.28l4.21,3.63c.32.31.49.73.5,1.17,0,.46-.17.87-.49,1.17-.15.14-.32.25-.51.32-.18.07-.38.11-.57.11s-.41-.04-.6-.12c-.2-.08-.37-.2-.53-.35l-.02-.02-3.67-4.25c-.14-.13-.4-.13-.55.01l-3.66,4.25c-.16.16-.34.28-.54.36-.37.15-.8.15-1.17,0-.19-.07-.36-.18-.51-.32C.18,16.12,0,15.71,0,15.25c0-.43.18-.86.49-1.16l.02-.02,4.21-3.63c.06-.06.1-.16.1-.27s-.04-.2-.11-.28L.51,6.26C.22,5.97.04,5.59,0,5.2c-.03-.41.09-.81.35-1.12.29-.35.71-.56,1.16-.58.45-.02.88.15,1.2.46l.02.02,3.67,4.25c.14.13.41.13.55-.02L14.09.49c.31-.31.72-.48,1.14-.48h.07v.02Z\"/></svg>";
const SCRIPT = "const $ = (s,r=document)=>r.querySelector(s);\nconst $$ = (s,r=document)=>[...r.querySelectorAll(s)];\nconst esc = s=>String(s).replace(/[&<>\"]/g,c=>({\"&\":\"&amp;\",\"<\":\"&lt;\",\">\":\"&gt;\",'\"':\"&quot;\"}[c]));\nconst GOALS = DATA.goals;\nconst ALL_IDS = new Set(GOALS.flatMap(g=>g.sc.map(s=>s.id)));\n\n/* Goal strip + scope */\n$(\"#goalStrip\").innerHTML = GOALS.map((g,i)=>`<a class=\"goal-chip\" href=\"#g-${g.id}\"><span class=\"n\">Goal ${i+1}</span><span class=\"t\">${esc(g.title)}</span></a>`).join(\"\");\n$(\"#scopeList\").innerHTML = (DATA.scope&&DATA.scope.length?DATA.scope:GOALS.map(g=>g.title)).map(t=>`<li>${esc(t)}</li>`).join(\"\");\n\n/* Platform map */\nconst COMPONENTS = DATA.components;\n$(\"#pmap\").innerHTML = COMPONENTS.map(([g,items])=>{items=items.map(([n,ids])=>[n,ids,ids.filter(i=>ALL_IDS.has(i))]);return `\n  <div class=\"prow\"><div class=\"g\">${esc(g)}</div><div class=\"pitems\">${items.map(([n,ids,shown])=> shown.length\n    ? `<button type=\"button\" class=\"comp\" data-ids=\"${shown.join(\",\")}\" data-name=\"${esc(n)}\" aria-pressed=\"false\" title=\"Criteria ${shown.join(\", \")}\">${esc(n)}<span class=\"c\">${shown.length}</span></button>`\n    : `<span class=\"comp out\" title=\"Not tested in this POV\">${esc(n)}</span>`).join(\"\")}</div></div>`}).join(\"\");\n\n/* Test plan */\n$(\"#fGoal\").insertAdjacentHTML(\"beforeend\", GOALS.map((g,i)=>`<option value=\"${g.id}\">Goal ${i+1}: ${esc(g.title)}</option>`).join(\"\"));\nconst msTags = ms=>{const m=String(ms||\"\").match(/M\\d/g)||[];return m.map(x=>`<span class=\"tag m\">Milestone ${x.slice(1)}</span>`).join(\"\")};\nconst stTag = s=> s.st ? `<span class=\"tag st ${s.st}\">${esc(s.stl)}</span>` : \"\";\nconst trRefs = tr=> tr.length ? `<div class=\"tr\">${esc(DATA.customer)} tracker: ${tr.map(n=>`<abbr title=\"${esc(DATA.tracker[n]||\"\")}\">#${esc(n)}</abbr>`).join(\", \")}</div>` : \"\";\n$(\"#goalsFull\").innerHTML = GOALS.map((g,i)=>`\n  <article class=\"goal\" id=\"g-${g.id}\" data-goal=\"${g.id}\">\n    <div class=\"goal-head\">\n      <div class=\"num\">${i+1}</div>\n      <div><h3>${esc(g.title)}</h3><p>${esc(g.stmt)}</p><div class=\"meta\">${g.sc.length} success criteria${g.driver?` \u00b7 Value driver: ${esc(g.driver)}`:\"\"}${g.measures&&g.measures.length?` \u00b7 Measured by: ${g.measures.map(esc).join(\"; \")}`:\"\"}</div></div>\n      <button type=\"button\" data-collapse aria-expanded=\"true\">Collapse</button>\n    </div>\n    <div class=\"goal-body\">\n      ${g.sc.map(s=>`\n      <div class=\"crit\" id=\"sc-${s.id}\">\n        <div><div class=\"id\">${s.id}</div><div class=\"name\">${esc(s.c)}</div>\n          <div class=\"tags\">${msTags(s.ms)}${stTag(s)}</div>${trRefs(s.tr)}</div>\n        <div><p class=\"lbl\">Test item</p><div class=\"test\">${esc(s.test)}</div></div>\n        <div><p class=\"lbl\">Benefit</p><div class=\"ben\">${esc(s.ben)}</div></div>\n      </div>`).join(\"\")}\n      <div class=\"empty\" hidden>No criteria in this goal match the filters.</div>\n    </div>\n  </article>`).join(\"\");\n\nconst F = {goal:\"all\",ids:null};\nfunction applyFilters(){\n  $$(\".goal\").forEach(gEl=>{\n    const gOk = F.goal===\"all\" || gEl.dataset.goal===F.goal;\n    let shown=0;\n    $$(\".crit\",gEl).forEach(c=>{\n      const id=c.id.slice(3);\n      const ok = gOk && (!F.ids||F.ids.includes(id));\n      c.style.display = ok?\"\":\"none\"; c.classList.toggle(\"hl\", !!F.ids && ok); if(ok) shown++;\n    });\n    const filtering = !!F.ids;\n    gEl.style.display = gOk && (shown || !filtering) ? \"\" : \"none\";\n    const e=$(\".empty\",gEl); e.hidden = shown>0;\n  });\n}\n$(\"#fGoal\").onchange=e=>{F.goal=e.target.value;applyFilters()};\nfunction clearComp(){F.ids=null;$$(\".comp[aria-pressed]\").forEach(b=>b.setAttribute(\"aria-pressed\",\"false\"));$(\"#compFilter\").classList.remove(\"on\");applyFilters()}\n$(\"#compClear\").onclick=clearComp;\n$(\"#pmap\").addEventListener(\"click\",e=>{\n  const b=e.target.closest(\".comp[data-ids]\"); if(!b) return;\n  if(b.getAttribute(\"aria-pressed\")===\"true\"){clearComp();return}\n  $$(\".comp[aria-pressed]\").forEach(x=>x.setAttribute(\"aria-pressed\",\"false\")); b.setAttribute(\"aria-pressed\",\"true\");\n  const ids=b.dataset.ids.split(\",\");\n  F.ids=ids; F.goal=\"all\"; $(\"#fGoal\").value=\"all\";\n  $(\"#compFilterLabel\").innerHTML = `${esc(b.dataset.name)}: ${ids.length} criteria`;\n  $(\"#compFilter\").classList.add(\"on\"); applyFilters();\n  $(\"#testplan\").scrollIntoView();\n});\ndocument.addEventListener(\"click\",e=>{\n  const c=e.target.closest(\"[data-collapse]\"); if(c){const g=c.closest(\".goal\");const on=!g.classList.toggle(\"collapsed\");c.textContent=on?\"Collapse\":\"Expand\";c.setAttribute(\"aria-expanded\",String(on));return}\n});\n\n\n/* Theme */\nconst root=document.documentElement;\nconst isDark=()=>{const t=root.getAttribute(\"data-theme\");return t?t===\"dark\":matchMedia(\"(prefers-color-scheme: dark)\").matches};\nconst label=()=>$(\"#themeBtn\").textContent=isDark()?\"Light theme\":\"Dark theme\";\ntry{const t=localStorage.getItem(\"meridian-guide-theme\");if(t)root.setAttribute(\"data-theme\",t)}catch(_){}\nlabel();\n$(\"#themeBtn\").onclick=()=>{const n=isDark()?\"light\":\"dark\";root.setAttribute(\"data-theme\",n);try{localStorage.setItem(\"meridian-guide-theme\",n)}catch(_){};label()};\n\n/* Active section */\nconst links=$$(\"nav.toc a\");\nconst io=new IntersectionObserver(es=>es.forEach(en=>{if(en.isIntersecting)links.forEach(a=>a.classList.toggle(\"active\",a.getAttribute(\"href\")===\"#\"+en.target.id))}),{rootMargin:\"-35% 0px -60% 0px\"});\n$$(\"main section\").forEach(s=>io.observe(s));\n";

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tbd = (what) => `<span class="tbd">${esc(what)}</span>`;
const or = (v, what) => (v ? esc(v) : tbd(what));
const day = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const STATUS = { done: 'Met', demo: 'Demonstrated', progress: 'In progress', planned: 'Planned', missed: 'Not met' };
const LABEL = { ide: 'IDE', scm: 'Source control', ai: 'AI coding assistant', feedback: 'Feedback channels', cicd: 'CI/CD', registry: 'Container registry' };
const COUNT = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];

/** The platform map: each component and the catalogue capabilities (or groups) that make it. */
const COMPONENTS = [
  ['Insights', [['Unified dashboard and reporting', ['analytics']], ['Cloud Insights', ['cloud-insights']]]],
  ['Posture', [['Application Security Posture Management (ASPM)', ['arm', 'risk-orchestration']], ['Policy management', ['policy']]]],
  ['Agentic AI', [['Developer Assist', ['dev-assist']], ['Triage Assist', ['ai-triage']], ['Remediation Assist', ['ai-remediation']], ['Checkmarx MCP', ['mcp']]]],
  ['Code security', [['SAST', ['sast', 'fusion', 'last']], ['Secrets detection', ['secrets']], ['IaC security', ['iac']], ['API security', ['apisec']]]],
  ['Supply chain', [['SCA', ['sca']], ['SBOM', ['sbom']], ['Container security', ['containers']], ['AI Supply Chain Security', ['aisc', 'llm-scanner', 'mcp-scanner', 'skills-scanner']], ['Malicious packages', ['malicious']], ['Repository health', ['scorecard']]]],
  ['Runtime', [['DAST', ['dast', 'dast-ai']], ['Partner cloud security and runtime protection', []]]],
  ['Developer enablement', [['IDE remediation guidance', ['dev-assist']], ['Codebashing', []]]],
  ['DevSecOps', [['SDLC integrations', [], ['scm', 'ci', 'cli', 'ide', 'tracking']]]],
  ['Platform', [['Role-based access and SSO', ['rbac', 'sso']], ['API access', ['api']], ['Scheduled scans', ['scheduled-scans']]]],
];

/**
 * @param {object} opp    the POV (placed: criteria with their category)
 * @param {object} story  resultsData(opp): goals and criteria with their state
 */
export function rwReport(opp, story, { owner = null, catalog = null, texts = {}, nonce = '' } = {}) {
  const C = opp.customer;
  const byId = Object.fromEntries((opp.criteria ?? []).map((c) => [c.id, c]));
  const capOf = (id) => byId[id]?.capabilityId || byId[id]?.capRef || '';
  const groupOf = (id) => (capOf(id) && catalog?.get(capOf(id))?.category) || byId[id]?.category || '';
  const crit = Object.fromEntries((story.criteria ?? []).map((c) => [c.id, c]));

  // The test plan: the goals in order, their criteria numbered goal.n
  let goals = (story.goals ?? []).filter((g) => g.ids?.length);
  if (!goals.length && story.criteria?.length) goals = [{ key: 'all', title: 'Success criteria', statement: 'Agreed with the team for this POV.', ids: story.criteria.map((c) => c.id) }];
  const number = {};
  const G = goals.map((g, gi) => ({
    id: `G${gi + 1}`,
    title: g.title,
    stmt: g.statement || '',
    driver: g.driver || '',
    measures: g.measures ?? [],
    sc: g.ids
      .filter((id) => crit[id])
      .map((id, n) => {
        const x = crit[id];
        number[id] = `${gi + 1}.${n + 1}`;
        const st = STATUS[x.state] ? x.state : '';
        return { id: number[id], c: x.title, test: x.test || '', ben: x.benefit || x.statement || '', tr: String(x.refs ?? '').split(/[,;\s]+/).map((r) => r.replace(/^#/, '')).filter(Boolean), ms: x.milestone || '', st, stl: STATUS[st] ?? '' };
      }),
  }));
  const allIds = Object.keys(number);
  const comps = COMPONENTS.map(([g, items]) => [g, items.map(([name, caps, groups = []]) => [name, allIds.filter((id) => caps.includes(capOf(id)) || groups.includes(groupOf(id))).map((id) => number[id])])]);
  const DATA = { customer: C, goals: G, tracker: {}, components: comps, scope: opp.plan?.scope ?? [] };

  // The toolchain: the tools in scope at each touch point, with the criteria that test them.
  const tc = opp.toolchain ?? {};
  const tools = TOOLCHAIN.map((t) => {
    const picked = tc[t.key]?.tools ?? [];
    const caps = t.tools.filter(([nm]) => picked.includes(nm)).map(([, id]) => id).filter(Boolean);
    return { ...t, picked, access: tc[t.key]?.access || t.access, ids: allIds.filter((id) => caps.includes(capOf(id))).map((id) => number[id]) };
  });
  const has = (k) => tools.find((t) => t.key === k)?.picked.length;
  const inScope = (...caps) => allIds.some((id) => caps.includes(capOf(id)));
  const phasesOn = new Set([...(has('ide') || has('ai') || has('scm') ? ['Code'] : []), ...(has('cicd') ? ['Build'] : []), ...(has('cicd') || inScope('dast', 'dast-ai', 'apisec') ? ['Test'] : []), ...(has('registry') || inScope('containers') ? ['Deploy'] : [])]);

  // Plan: the meetings in order; approval gates lettered A, B…, the rest numbered.
  // The POV's own plan first, then its presentation template's words, then the defaults.
  const support = opp.plan?.support?.length ? opp.plan.support : texts.support?.length ? texts.support : PLAN_DEFAULTS.support;
  const success = opp.plan?.success?.length ? opp.plan.success : texts.success?.length ? texts.success : PLAN_DEFAULTS.success;
  const sessions = [...(opp.sessions ?? [])].filter((s) => !['first_call', 'discovery'].includes(s.type)).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let n = 0;
  let gate = 0;
  const timeline = sessions.map((s) => {
    const isGate = s.type === 'gate';
    const dot = isGate ? String.fromCharCode(65 + gate++) : String(++n);
    const what = String(s.did || s.notes || '').split(/\n+/)[0];
    return `<li${isGate ? ' class="gate"' : ''}><span class="dot">${dot}</span><h4>${esc(s.title)}</h4><div class="when">${s.date ? esc(day(s.date)) : tbd('date')}</div>${what ? `<div class="what">${esc(what)}</div>` : ''}</li>`;
  });

  // Team and environment
  const people = [...(opp.stakeholders ?? [])];
  if (owner && !people.some((p) => p.email && p.email === owner.email)) people.push({ name: owner.name, email: owner.email, side: 'internal', povRole: 'Checkmarx technical lead' });
  const row = (p) => `<tr><td>${esc(p.name)}</td><td>${or(p.povRole, 'role')}</td><td>${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : tbd('email')}</td></tr>`;
  const theirs = people.filter((p) => p.side !== 'internal');
  const ours = people.filter((p) => p.side === 'internal');
  const weeks = opp.startDate && opp.endDate ? Math.max(1, Math.round((Date.parse(opp.endDate) - Date.parse(opp.startDate)) / (7 * 86_400_000))) : 0;
  const duration = weeks ? `${weeks} week${weeks === 1 ? '' : 's'}` : '';
  const dates = opp.startDate && opp.endDate ? `${day(opp.startDate)} – ${day(opp.endDate)}` : '';
  const solutions = [...new Set(allIds.map(capOf).filter(Boolean).map((cid) => catalog?.get(cid)).filter((c) => c && ['code', 'supply', 'aisc', 'runtime', 'agents', 'aspm'].includes(c.category)).map((c) => c.name.replace(/\s*\(.*\)$/, '')))];
  const languages = tc.languages || opp.discovery?.languages || '';
  const status = opp.stage === 'completed' ? 'Completed' : opp.stage === 'pov' ? 'In progress' : 'Draft for review';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(C)} · Checkmarx One Proof of Value Guide</title>
<style>${CSS}${EXTRA}</style>
</head>
<body>
<header class="topbar">${LOGO}<span class="doc">${esc(C)} · Proof of Value Guide</span><span class="spacer"></span><button type="button" class="iconbtn" id="themeBtn">Dark theme</button></header>
<div class="wrap">
<nav class="toc" aria-label="Sections"><ol>
  <li><a href="#overview">Overview</a></li><li><a href="#sdlc">Your DevSecOps toolchain</a></li><li><a href="#platform">Platform components</a></li><li><a href="#plan">Plan and timeline</a></li><li><a href="#environment">Team and environment</a></li><li><a href="#testplan">Test plan</a></li>
</ol></nav>
<main>
<section id="overview" style="padding-top:24px">
  <div class="cover">${LOGO}${MARK}
    <p class="customer">${esc(C)}</p>
    <h1>Checkmarx One Proof of Value Guide</h1>
    <p>${G.length ? `${COUNT[G.length - 1] ?? G.length} business goal${G.length === 1 ? '' : 's'}, tested on ${esc(C)}’s code against success criteria we agree at kickoff.` : 'Business goals and success criteria agreed at kickoff.'}</p>
    <div class="facts"><span><b>POV dates</b> ${dates ? esc(dates) : tbd('POV dates')}</span><span><b>Duration</b> ${duration || tbd('duration')}</span><span><b>Status</b> ${status}</span></div>
    <p class="callout">Secure what comes next.</p>
  </div>
  <div class="goals" id="goalStrip"></div>
</section>
<section id="sdlc">
  <p class="eyebrow">Tailored to your DevSecOps</p>
  <h2>Integrated with ${esc(C)}’s toolchain</h2>
  <p class="lede">Scanning runs where ${esc(C)}’s code is written, built, and tested. The tools below are the ones in scope for this POV.</p>
  <div class="phases" aria-label="SDLC phases covered in this POV">${DEVSECOPS.map((p) => `<span${phasesOn.has(p) ? ' class="on"' : ''}>${p}</span>`).join('')}</div>
  <div class="tools">${tools.map((t) => `<div class="tool"><h4>${LABEL[t.key] ?? t.label} <small>${t.ids.join(', ')}</small></h4><ul>${t.picked.length ? t.picked.map((x) => `<li>${esc(x)}</li>`).join('') : `<li>${tbd((LABEL[t.key] ?? t.label).toLowerCase())}</li>`}</ul></div>`).join('')}</div>
  ${opp.plan?.outOfScope ? `<div class="rule"><b>Out of scope.</b> ${esc(opp.plan.outOfScope)}</div>` : ''}
</section>
<section id="platform">
  <p class="eyebrow">Checkmarx One</p>
  <h2>Components in this POV</h2>
  <p class="lede">Select a component to see the success criteria that test it.</p>
  <div class="legend"><span><i class="in"></i>In this POV (number of criteria in this guide)</span><span><i class="out"></i>Not tested in this POV</span></div>
  <div class="pmap" id="pmap"></div>
  ${inScope('dev-assist') ? '<div class="flow"><h3>How Developer Assist works in the IDE</h3><ol><li><b>Real-time scan</b>Code is checked as developers or AI assistants write it.</li><li><b>Suggested fix</b>A fix following Checkmarx best practices is proposed.</li><li><b>Apply the fix</b>Safe Refactor applies the change, including related updates.</li><li><b>Or ignore it</b>The developer stays in control of every change.</li></ol><p class="engines">Real-time scanners: SAST, SCA, malicious packages, IaC security, container security, and secrets detection.</p></div>' : ''}
</section>
<section id="plan">
  <p class="eyebrow">POV plan and timeline</p>
  <h2>How the POV runs</h2>
  <div class="three">
    <div class="card"><h3>Scope</h3><p class="sub">Focused on ${esc(C)}’s goals</p><ul id="scopeList"></ul></div>
    <div class="card"><h3>Support</h3><p class="sub">Ensuring a smooth POV</p><ul>${support.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
    <div class="card"><h3>Success</h3><p class="sub">Tested, not asserted</p><ul>${success.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
  </div>
  <ol class="timeline" aria-label="POV timeline">${timeline.join('') || `<li><span class="dot">1</span><h4>Kickoff and onboarding</h4><div class="when">${tbd('date')}</div><div class="what">Confirm scope and the success criteria.</div></li><li><span class="dot">2</span><h4>Wrap-up call</h4><div class="when">${tbd('date')}</div><div class="what">Review results against every agreed success criterion.</div></li>`}</ol>
</section>
<section id="environment">
  <p class="eyebrow">POV environment details</p>
  <h2>Team and environment</h2>
  <div class="tblwrap"><table class="tbl"><thead><tr><th>Name</th><th>POV role</th><th>Email</th></tr></thead><tbody>
    <tr class="grp"><td colspan="3">${esc(C)}</td></tr>${theirs.map(row).join('') || `<tr><td colspan="3">${tbd('the customer’s team')}</td></tr>`}
    <tr class="grp"><td colspan="3">Checkmarx</td></tr>${ours.map(row).join('')}
  </tbody></table></div>
  <div class="two">
    <div class="tblwrap"><table class="tbl"><thead><tr><th colspan="2">Environment details</th></tr></thead><tbody>
      <tr><td>POV dates</td><td>${dates ? esc(dates) : tbd('dates')}</td></tr>
      <tr><td>POV duration</td><td>${duration || tbd('duration')}</td></tr>
      <tr><td>Solutions tested</td><td>${solutions.length ? `Checkmarx One: ${esc(solutions.join(', '))}` : tbd('solutions')}</td></tr>
      <tr><td>Tenant name</td><td>${or(opp.tenant?.tenant || opp.plan?.accountName, 'tenant name')}</td></tr>
      <tr><td>Tenant URL</td><td>${or(opp.tenant?.baseUrl, 'tenant URL')}</td></tr>
      <tr><td>Deployment</td><td>SaaS</td></tr>
      <tr><td>User access</td><td>${inScope('sso') ? 'Single sign-on, tested in this POV.' : 'Users are added manually. SSO is out of POV scope.'}</td></tr>
    </tbody></table></div>
    <div class="tblwrap"><table class="tbl"><thead><tr><th>Integration</th><th>Access needed</th><th>Tools</th></tr></thead><tbody>
      ${tools.map((t) => `<tr><td>${LABEL[t.key] ?? t.label}</td><td>${or(t.access, 'access')}</td><td>${t.picked.length ? esc(t.picked.join(', ')) : tbd('tools')}</td></tr>`).join('')}
      <tr><td>Languages</td><td colspan="2">${or(languages, 'languages')}</td></tr>
      <tr><td>Repositories</td><td colspan="2">${or(opp.plan?.repositories, 'repository list')}</td></tr>
      ${inScope('dast', 'dast-ai', 'apisec') ? `<tr><td>DAST and API targets</td><td colspan="2">${or(opp.plan?.targets, 'applications and APIs')}</td></tr>` : ''}
    </tbody></table></div>
  </div>
</section>
<section id="testplan">
  <p class="eyebrow">Test plan</p>
  <h2>Business goals and success criteria</h2>
  <p class="lede">Each goal lists what we test and what ${esc(C)} gains.</p>
  <div class="filters"><label for="fGoal">Goal</label><select id="fGoal"><option value="all">All goals</option></select><span class="activefilter" id="compFilter"><span id="compFilterLabel"></span><button type="button" id="compClear">Clear</button></span></div>
  <div id="goalsFull"></div>
</section>
</main>
</div>
<footer><span class="tag-line">Secure what comes next.</span><span>© ${new Date().getFullYear()} Checkmarx Ltd. All rights reserved. Prepared for ${esc(C)}. ${status}.</span></footer>
<script${nonce ? ` nonce="${nonce}"` : ''}>
const DATA = ${JSON.stringify(DATA).replace(/</g, '\\u003c')};
${SCRIPT}
</script>
</body>
</html>`;
}
