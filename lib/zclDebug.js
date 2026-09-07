'use strict';

// Homey's zigbee-clusters resolves writeAttributes() successfully even when
// the device rejects individual attributes — the per-attribute status array
// the device sends back (SUCCESS / MALFORMED_COMMAND / UNSUPPORTED_ATTRIBUTE /
// INVALID_DATA_TYPE / etc, see zigbee-clusters/lib/Cluster.js writeAttributes
// command's `response.args.attributes`) is returned from the call but was
// never being inspected anywhere in this app, so a rejected write looked
// identical to a successful one in the logs. See docs/DEVELOPMENT_NOTES.md
// ("Cómo depurar comandos que el dispositivo rechaza").
//
// Use this instead of calling cluster.writeAttributes(...) directly whenever
// you want rejections to actually show up in `homey app run` logs.
async function writeAttributesVerbose(device, cluster, attributes) {
  const response = await cluster.writeAttributes(attributes);

  if (response && Array.isArray(response.attributes)) {
    for (const entry of response.attributes) {
      if (entry.status !== 'SUCCESS') {
        const attrName = Object.keys(cluster.constructor.attributes || {})
          .find((name) => cluster.constructor.attributes[name].id === entry.id) || `id_${entry.id}`;
        device.error(
          `Device REJECTED write to '${attrName}' on ${cluster.constructor.NAME}: ${entry.status}`,
        );
      }
    }
  }

  return response;
}

module.exports = { writeAttributesVerbose };
