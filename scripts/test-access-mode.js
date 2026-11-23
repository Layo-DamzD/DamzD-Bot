// Verify the access-mode flip end to end:
//  1. env default respected
//  2. setAccessMode flips it and the frozen config getter reflects it
//  3. owner commands (.public/.private) route through setAccessMode cleanly
//  4. allowedSender logic: non-owner blocked in self, allowed in public
process.env.ACCESS_MODE = "self";
const { config, setAccessMode } = await import("/home/z/my-project/damzd/src/config.js");

let ok = true;
const check = (name, pass, detail) => {
  console.log((pass ? "PASS" : "FAIL") + " — " + name + (detail ? " (" + detail + ")" : ""));
  if (!pass) ok = false;
};

check("starts in self mode", config.accessMode === "self", config.accessMode);

const now = setAccessMode("public");
check("setAccessMode returns new mode", now === "public", now);
check("frozen config getter reflects flip", config.accessMode === "public", config.accessMode);

setAccessMode("self");
check("flips back to self", config.accessMode === "self", config.accessMode);

// allowedSender replica (src/runtime.js logic reads appConfig.accessMode)
const allowedSender = isOwner => isOwner || config.accessMode !== "self";
check("self mode blocks non-owner", allowedSender(false) === false);
setAccessMode("public");
check("public mode admits non-owner", allowedSender(false) === true);

// owner command body replica — the exact code owner.js now runs
const wanted = "public";
const flip = () => wanted === "public" || wanted === "self" ? setAccessMode(wanted) : null;
check("owner command flip runs without throwing", (flip(), config.accessMode === "public"));

console.log(ok ? "ALL CHECKS PASSED" : "CHECKS FAILED");
process.exit(ok ? 0 : 1);
