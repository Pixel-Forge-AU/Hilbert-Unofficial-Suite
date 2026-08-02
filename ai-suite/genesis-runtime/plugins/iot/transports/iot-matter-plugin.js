/**
 * Plugin Name: IoT Matter Transport
 * Plugin Slug: iot-matter
 * Description: Matter protocol transport stub. Matter requires a native controller node
 *              (@project-chip/matter-node.js). This plugin registers the tools and provides
 *              clear setup guidance when the runtime dependency is absent.
 * Version: 1.0.0
 * Author: Nova Observer
 */

const MATTER_SETUP_GUIDE = `Matter transport requires the matter-node.js controller package.

Setup steps:
1. Install the controller: npm install @project-chip/matter-node.js
2. Pair your Matter devices with this controller using matter_pair_device.
3. Devices must be on the same network as the Observer host.

Supported device types: lights, switches, outlets, locks, thermostats, sensors (any Matter-compliant device).
Pairing uses a Matter setup code (printed on the device or shown in its app).`;

async function loadMatterController() {
  try {
    const mod = await import("@project-chip/matter-node.js");
    return mod;
  } catch {
    throw new Error(`Matter controller is not available.\n\n${MATTER_SETUP_GUIDE}`);
  }
}

export function createIotMatterPlugin(options = {}) {
  const {
    pluginId = "iot-matter",
    pluginName = "IoT Matter Transport",
    description = "Matter protocol transport for IoT device control (requires @project-chip/matter-node.js)."
  } = options;

  return {
    id: pluginId,
    name: pluginName,
    version: "1.0.0",
    description,
    manifest: {
      schemaVersion: 1,
      permissions: {
        routes: false,
        uiPanels: false,
        data: false,
        tools: [
          "matter_status",
          "matter_list_devices",
          "matter_get_state",
          "matter_pair_device",
          "matter_remove_device",
          "matter_send_command"
        ],
        capabilities: ["iot-matter.status"],
        hooks: [],
        runtimeContext: []
      },
      dependencies: {
        requiredCapabilities: [],
        optionalCapabilities: []
      },
      security: { isolation: "inprocess" }
    },

    async init(api) {
      let controllerAvailable = false;
      try {
        await loadMatterController();
        controllerAvailable = true;
      } catch {
        // not installed — tools will surface the setup guide
      }

      if (typeof api.provideCapability === "function") {
        api.provideCapability("iot-matter.status", () => ({
          available: controllerAvailable,
          setupGuide: controllerAvailable ? null : MATTER_SETUP_GUIDE
        }));
      }

      function makeStubHandler(toolName) {
        return async () => {
          if (!controllerAvailable) {
            throw new Error(`Matter controller is not installed.\n\n${MATTER_SETUP_GUIDE}`);
          }
          // When matter-node.js is installed, real implementations go here.
          throw new Error(`${toolName}: Matter controller integration not yet implemented. The package is installed — open an issue to request full implementation.`);
        };
      }

      if (typeof api.registerTool === "function") {
        api.registerTool({ name: "matter_status", description: "Check whether the Matter controller is installed and ready. Returns setup instructions if not available.", scopes: ["worker"], risk: "normal" });
        api.registerTool({ name: "matter_list_devices", description: "List paired Matter devices on this controller.", scopes: ["worker"], risk: "normal" });
        api.registerTool({ name: "matter_get_state", description: "Get the current state of a paired Matter device by nodeId.", scopes: ["worker"], risk: "normal", parameters: { nodeId: "string" } });
        api.registerTool({ name: "matter_pair_device", description: "Pair a new Matter device using its setup code (printed on device or from app).", scopes: ["worker"], risk: "high", parameters: { setupCode: "string", label: "string" } });
        api.registerTool({ name: "matter_remove_device", description: "Remove a paired Matter device from this controller.", scopes: ["worker"], risk: "high", parameters: { nodeId: "string" } });
        api.registerTool({ name: "matter_send_command", description: "Send a cluster command to a Matter device (e.g. OnOff cluster: on/off/toggle).", scopes: ["worker"], risk: "high", parameters: { nodeId: "string", endpointId: "number", clusterId: "string", command: "string", args: "object" } });
      }

      // Wire tool calls to stub handlers until real implementation exists
      if (typeof api.handleToolCall === "function") {
        const MATTER_TOOLS = new Set([
          "matter_status", "matter_list_devices", "matter_get_state",
          "matter_pair_device", "matter_remove_device", "matter_send_command"
        ]);
        api.handleToolCall(async (payload, next) => {
          const name = String(payload?.name || "").trim();
          if (!MATTER_TOOLS.has(name)) return next(payload);
          if (name === "matter_status") {
            return {
              available: controllerAvailable,
              text: controllerAvailable
                ? "Matter controller is installed and ready."
                : "Matter controller is not installed.",
              setupGuide: controllerAvailable ? null : MATTER_SETUP_GUIDE
            };
          }
          return makeStubHandler(name)();
        });
      }
    }
  };
}
