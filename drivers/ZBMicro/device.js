'use strict';

const { ZigBeeDevice } = require("homey-zigbeedriver");

const SonoffOnOffCluster = require("../../lib/SonoffOnOffCluster");

const { Cluster, CLUSTER } = require('zigbee-clusters');

Cluster.addCluster(SonoffOnOffCluster);

class SonoffZBMicro extends ZigBeeDevice {

    async onNodeInit({ zclNode }) {
        this.log('Device initialized');
        this.printNode();

        if (this.hasCapability('onoff')) {
            this.registerCapability('onoff', CLUSTER.ON_OFF);
        }

        try {
            const { powerOnBehavior } = await this.zclNode.endpoints[1].clusters.onOff.readAttributes('powerOnBehavior');
            await this.setSettings({ power_on_behavior: powerOnBehavior }).catch(this.error); //, switch_type: switchType });
        } catch (e) {
            this.log("Could not read / update device settings", e);
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
  }

}

module.exports = SonoffZBMicro;
