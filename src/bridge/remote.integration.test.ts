import { afterAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { RemoteBridge } from "./remote";

const enabled = process.env.PHOSON_REMOTE_INTEGRATION === "1";
const engine = resolve(process.cwd(), "../phoson-engine-minimal");
const python = join(engine, ".venv/bin/python");
const gatewayScript = String.raw`
import asyncio, json, os, sys
from pathlib import Path
from phoson_bridge import gateway as G
from phoson_bridge.devices import DeviceStore
async def main():
    workspace = Path(os.environ['PHOSON_TEST_WORKSPACE'])
    store = DeviceStore()
    code, _ = store.create_pairing_code()
    command = [sys.executable, '-m', 'phoson_bridge'] if os.environ.get('PHOSON_TEST_REAL_BRIDGE') == '1' else [sys.executable, os.environ['PHOSON_TEST_FAKE']]
    config = G.GatewayConfig(host='127.0.0.1', port=0, default_workspace=workspace, command=command)
    ports=[]
    server=asyncio.create_task(G.serve(config, ready=ports.append))
    while not ports: await asyncio.sleep(.01)
    print(json.dumps({'port':ports[0], 'code':code}), flush=True)
    try: await server
    except asyncio.CancelledError: pass
asyncio.run(main())
`;

function isolatedEnv(home: string, workspace: string, fake?: string) {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, PHOSON_HOME: join(home, ".phoson"),
    PHOSON_TEST_WORKSPACE: workspace, PYTHONPATH: engine, PYTHONNOUSERSITE: "1",
    ...(fake ? { PHOSON_TEST_FAKE: fake } : {}),
  };
}

describe.skipIf(!enabled)("RemoteBridge gateway integration", () => {
  let child: ChildProcess | undefined;
  let temp = "";
  let stderr = "";
  afterAll(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>(resolve => {
        child!.once("exit", () => resolve());
        child!.kill("SIGTERM");
      });
    }
    if (temp) await rm(temp, { recursive: true, force: true });
  });

  async function connect(real: boolean) {
    temp = await mkdtemp(join(tmpdir(), "phoson-remote-"));
    const home = join(temp, "home"), workspace = join(temp, "workspace");
    await Promise.all([mkdir(home), mkdir(workspace)]);
    const marker = join(workspace, "remote-integration-marker.txt");
    await writeFile(marker, "integration marker\n");
    let fake: string | undefined;
    if (!real) {
      fake = join(temp, "fake.py");
      await writeFile(fake, "import json,sys\nfor line in sys.stdin:\n m=json.loads(line)\n if 'id' in m: print(json.dumps({'jsonrpc':'2.0','id':m['id'],'result':{'method':m['method'],'params':m.get('params',{})}}),flush=True)\n");
    }
    child = spawn(python, ["-c", gatewayScript], {
      cwd: engine, env: { ...isolatedEnv(home, workspace, fake), ...(real ? { PHOSON_TEST_REAL_BRIDGE: "1" } : {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", chunk => { stderr += chunk; });
    const lines = createInterface({ input: child.stdout! });
    const startup = await new Promise<{ port: number; code: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Gateway startup timed out. stderr: ${stderr}`)), 20000);
      lines.once("line", line => { clearTimeout(timer); try { resolve(JSON.parse(line)); } catch (error) { reject(error); } });
      child!.once("error", error => { clearTimeout(timer); reject(error); });
      child!.once("exit", code => { clearTimeout(timer); reject(new Error(`Gateway exited: ${code}. stderr: ${stderr}`)); });
    });
    const bridge = await RemoteBridge.connect({ url: `ws://127.0.0.1:${startup.port}/v1`, code: startup.code, workspace });
    return { bridge, lines, workspace, marker };
  }

  it("routes RPC through a separate fake transport", async () => {
    const { bridge, lines } = await connect(false);
    try {
      expect(bridge.connected).toBe(true);
      await expect(bridge.rpc("test.echo", { value: 7 })).resolves.toMatchObject({ method: "test.echo", params: { value: 7 } });
      expect(bridge.takeToken()).toBeTruthy();
    } finally { bridge.close(); lines.close(); }
  }, 30000);

  it("initializes the offline real bridge and reconnects with its device token", async () => {
    const { bridge, lines, workspace } = await connect(true);
    try {
      expect(bridge.connected).toBe(true);
      expect(bridge.workspace).toBe(await realpath(workspace));
      const token = bridge.takeToken();
      if (typeof bridge.takeToken === "function") expect(token).toBeTruthy();
      await expect(bridge.rpc("system.ping")).resolves.toBeDefined();
      await expect(bridge.rpc("initialize")).resolves.toMatchObject({ onboarding: { needed: true } });
      await expect(bridge.rpc("fs.cwd")).resolves.toMatchObject({ cwd: await realpath(workspace) });
      const listing = await bridge.rpc<any>("fs.list", { path: workspace });
      expect(JSON.stringify(listing)).toContain("remote-integration-marker.txt");
      bridge.close();
      if (token) {
        const second = await RemoteBridge.connect({ url: bridge.url, token, workspace });
        try { expect(second.connected).toBe(true); } finally { second.close(); }
      }
    } finally { bridge.close(); lines.close(); }
  }, 60000);
});
