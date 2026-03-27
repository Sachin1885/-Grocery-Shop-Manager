const { execFileSync } = require("child_process");
const path = require("path");

const port = Number(process.argv[2] || process.env.PORT || 4000);

if (process.platform === "win32") {
  const ps1 = path.join(__dirname, "free-port.ps1");
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, "-Port", String(port)],
    { stdio: "inherit" }
  );
} else {
  const { execSync } = require("child_process");
  try {
    execSync(`fuser -k ${port}/tcp`, { stdio: "inherit" });
  } catch {
    console.log(`Port ${port} — agar ab bhi busy ho to manually process band karein.`);
  }
}
