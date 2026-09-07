'use strict';

const { ZigBeeDevice } = require("homey-zigbeedriver");

const SonoffOnOffCluster = require("../../lib/SonoffOnOffCluster");
const { Cluster, CLUSTER, BoundCluster } = require('zigbee-clusters');
try {
    Cluster.addCluster(SonoffOnOffCluster);
} catch (err) {
    // Cluster might already be registered by another driver
}

const SonoffCluster = require("../../lib/SonoffCluster");
try {
    Cluster.addCluster(SonoffCluster);
} catch (err) {
    // Cluster might already be registered by another driver
}

const SonoffBase = require('../sonoffbase');

// MINI-ZBD is a dry-contact relabel of ZBMINIR2 — same firmware/converter in
// zigbee-herdsman-converters (whiteLabel entry, identical exposes). Kept as
// its own driver (own name/pairing instructions, since it has no physical
// button — it's meant to be wired into a junction box) rather than merged
// into ZBMINIR2's productId list.
class MyOnOffBoundCluster extends BoundCluster {
    constructor(node) {
        super();
        this.node = node;
        this._click = node.homey.flow.getDeviceTriggerCard("MINI-ZBD:click");
    }
    toggle() {
        this._click.trigger(this.node, {}, {}).catch(this.node.error);
    }
}

const SonoffClusterAttributes = [
	'power_on_delay_state',
	'power_on_delay_time',
    'switch_mode',
    'detach_mode',
    'turbo_mode'
];

class SonoffMiniZBD extends SonoffBase {

    async onNodeInit({ zclNode }) {

        super.onNodeInit({zclNode});

        if (this.hasCapability('onoff')) {
            this.registerCapability('onoff', CLUSTER.ON_OFF);
        }

        this.configureAttributeReporting([
			{
				endpointId: 1,
				cluster: CLUSTER.ON_OFF,
				attributeName: 'onOff',
                minInterval: 0,
                maxInterval: 3600
			}
		]).catch(this.error);

        this.zclNode.endpoints[1].bind(CLUSTER.ON_OFF.NAME, new MyOnOffBoundCluster(this));

        await this._setupMigrateToSocket();

        this.checkAttributes();
    }

    async _setupMigrateToSocket() {
        const isLight = this.getClass() === 'light';
        if (isLight) {
            if (!this.hasCapability('migrate_to_socket')) {
                await this.addCapability('migrate_to_socket').catch(this.error);
            }
            this.registerCapabilityListener('migrate_to_socket', async () => {
                this.log('Migrating device class from light to socket');
                await this.setClass('socket');
                await this.removeCapability('migrate_to_socket').catch(this.error);
            });
        } else if (this.hasCapability('migrate_to_socket')) {
            await this.removeCapability('migrate_to_socket').catch(this.error);
        }
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        if (changedKeys.includes("power_on_behavior")) {
            try {
                await this.zclNode.endpoints[1].clusters.onOff.writeAttributes({ powerOnBehavior: newSettings.power_on_behavior });
            } catch (error) {
                this.log("Error updating the power on behavior");
            }
        }

        if (changedKeys.includes("turbo_mode")) {
            newSettings.turbo_mode = newSettings.turbo_mode ? 20 : 9;
        }

        this.writeAttributes(SonoffCluster, newSettings, changedKeys).catch(this.error);
  }

  async checkAttributes() {

    this.readAttribute(CLUSTER.ON_OFF, ['powerOnBehavior'], (data) => {
        this.setSettings({ power_on_behavior: data.powerOnBehavior }).catch(this.error);
    });

    this.readAttribute(SonoffCluster, SonoffClusterAttributes, (data) => {
        if (data.turbo_mode !== undefined) {
            data.turbo_mode = data.turbo_mode === 20;
        }
        this.setSettings(data).catch(this.error);
    });

  }

    async onDeleted() {
        this.log("smartswitch removed");
    }

}

module.exports = SonoffMiniZBD;
