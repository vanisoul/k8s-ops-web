const NAMESPACE = process.env.NAMESPACE;
const DEPLOYMENT = process.env.DEPLOYMENT;

if (!NAMESPACE || !DEPLOYMENT) {
  throw new Error("NAMESPACE and DEPLOYMENT environment variables are required");
}

async function runCommand(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const proc = Bun.spawn(["kubectl", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { stdout: "", stderr: message, exitCode: 1 };
  }
}

export async function restartDeployment(): Promise<{ success: boolean; message: string }> {
  // Scale to 0
  const scaleDown = await runCommand([
    "scale", "deployment", DEPLOYMENT, "-n", NAMESPACE, "--replicas=0",
  ]);
  if (scaleDown.exitCode !== 0) {
    return { success: false, message: `Scale down failed: ${scaleDown.stderr}` };
  }

  // Wait a moment for pods to terminate
  await Bun.sleep(2000);

  // Scale back to 1
  const scaleUp = await runCommand([
    "scale", "deployment", DEPLOYMENT, "-n", NAMESPACE, "--replicas=1",
  ]);
  if (scaleUp.exitCode !== 0) {
    return { success: false, message: `Scale up failed: ${scaleUp.stderr}` };
  }

  return { success: true, message: `Deployment ${DEPLOYMENT} restarted successfully` };
}

export async function getPodLogs(tailLines = 200): Promise<{ success: boolean; logs: string }> {
  // Get pod name first
  const pods = await runCommand([
    "get", "pods", "-n", NAMESPACE, "-l", `app=${DEPLOYMENT}`,
    "-o", "jsonpath={.items[0].metadata.name}",
  ]);

  if (pods.exitCode !== 0 || !pods.stdout) {
    return { success: false, logs: `No pods found: ${pods.stderr}` };
  }

  const result = await runCommand([
    "logs", pods.stdout, "-n", NAMESPACE, `--tail=${tailLines}`,
  ]);

  return { success: result.exitCode === 0, logs: result.stdout || result.stderr };
}

export async function getPodResources(): Promise<{ success: boolean; data: string }> {
  const result = await runCommand(["top", "pod", "-n", NAMESPACE]);
  return { success: result.exitCode === 0, data: result.stdout || result.stderr };
}

export async function getStatus(): Promise<{
  success: boolean;
  deployment: string;
  pods: string;
}> {
  const [dep, pods] = await Promise.all([
    runCommand(["get", "deployment", DEPLOYMENT, "-n", NAMESPACE, "-o", "wide"]),
    runCommand(["get", "pods", "-n", NAMESPACE, "-o", "wide"]),
  ]);

  return {
    success: dep.exitCode === 0,
    deployment: dep.stdout || dep.stderr,
    pods: pods.stdout || pods.stderr,
  };
}
