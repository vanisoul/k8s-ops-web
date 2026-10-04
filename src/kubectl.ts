const NAMESPACE = process.env.NAMESPACE;
const DEPLOYMENT = process.env.DEPLOYMENT;
const POD_LABEL_KEY = process.env.POD_LABEL_KEY || "app";

if (!NAMESPACE || !DEPLOYMENT) {
  throw new Error("NAMESPACE and DEPLOYMENT environment variables are required");
}
if (!/^(?:[a-z0-9]([-a-z0-9_.]*[a-z0-9])?\/)?[a-z0-9]([-a-z0-9_.]*[a-z0-9])?$/.test(POD_LABEL_KEY)) {
  throw new Error("POD_LABEL_KEY must be a valid Kubernetes label key");
}

export async function runCommand(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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

export async function getAvailability(): Promise<boolean | null> {
  const result = await runCommand(["get", "deployment", DEPLOYMENT!, "-n", NAMESPACE!, "-o", "json"]);
  if (result.exitCode !== 0) {
    console.error(`Cannot check deployment availability: ${result.stderr}`);
    return null;
  }
  try {
    const deployment = JSON.parse(result.stdout);
    if (typeof deployment.status?.availableReplicas !== "number" && deployment.status?.availableReplicas !== undefined) {
      throw new Error("invalid status.availableReplicas");
    }
    return (deployment.status?.availableReplicas ?? 0) > 0;
  } catch (error) {
    console.error(`Cannot parse deployment availability: ${error}`);
    return null;
  }
}

export type LogSource = { pod: string; container: string; id: string };

export async function getLogSources(): Promise<LogSource[] | null> {
  const result = await runCommand(["get", "pods", "-n", NAMESPACE!, "-l", `${POD_LABEL_KEY}=${DEPLOYMENT}`, "-o", "json"]);
  if (result.exitCode !== 0) {
    console.error(`Cannot list log pods: ${result.stderr}`);
    return null;
  }
  try {
    const pods = JSON.parse(result.stdout);
    if (!Array.isArray(pods.items)) throw new Error("invalid pod list");
    const sources: LogSource[] = [];
    for (const pod of pods.items) {
      if (typeof pod.metadata?.name !== "string" || typeof pod.metadata?.uid !== "string" ||
          !Array.isArray(pod.spec?.containers)) throw new Error("invalid pod metadata or containers");
      for (const container of pod.spec.containers) {
        if (typeof container.name !== "string") throw new Error("invalid container name");
        sources.push({ pod: pod.metadata.name, container: container.name,
          id: `${pod.metadata.uid}/${container.name}` });
      }
    }
    return sources;
  } catch (error) {
    console.error(`Cannot parse log pod list: ${error}`);
    return null;
  }
}

export function followLogs(source: LogSource, since: Date): ReturnType<typeof Bun.spawn> {
  return Bun.spawn(["kubectl", "logs", "-f", source.pod, "-n", NAMESPACE!, "-c", source.container,
    "--timestamps=true", "--tail=-1", `--since-time=${since.toISOString()}`], {
    stdout: "pipe", stderr: "pipe",
  });
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
    "get", "pods", "-n", NAMESPACE, "-l", `${POD_LABEL_KEY}=${DEPLOYMENT}`,
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
