'use strict';

const { ZigBeeDevice } = require("homey-zigbeedriver");

const SonoffOnOffCluster = require("../../lib/SonoffOnOffCluster");
//const SonoffOnOffSwitchCluster = require("../../lib/SonoffOnOffSwitchCluster");

const { Cluster, CLUSTER } = require('zigbee-clusters');

Cluster.addCluster(SonoffOnOffCluster);
//Cluster.addCluster(SonoffOnOffSwitchCluster);

class SonoffZBMINIL2 extends ZigBeeDevice {

 /**
   * onInit is called when the device is initialized.
   */
    async onNodeInit({ zclNode }) {
        this.log('Device initialized');
        this.printNode();

        if (this.hasCapability('onoff')) {
            this.registerCapability('onoff', CLUSTER.ON_OFF);
        }

        await this._setupMigrateToSocket();

        try {
            const { powerOnBehavior } = await this.zclNode.endpoints[1].clusters.onOff.readAttributes('powerOnBehavior');
            //const { switchType, switchAction } = await this.zclNode.endpoints[1].clusters.onOffSwitch.readAttributes('switchType', 'switchAction');
            await this.setSettings({ power_on_behavior: powerOnBehavior }).catch(this.error); //, switch_type: switchType });
        } catch (e) {
            this.log("Could not read / update device settings", e);
        }
    }

    /**
     * onSettings is called when the user updates the device's settings.
     * @param {object} event the onSettings event data
     * @param {object} event.oldSettings The old settings object
     * @param {object} event.newSettings The new settings object
     * @param {string[]} event.changedKeys An array of keys changed since the previous version
     * @returns {Promise<string|void>} return a custom message that will be displayed
     */
    async onSettings({ oldSettings, newSettings, changedKeys }) {
        if (changedKeys.includes("power_on_behavior")) {
            try {
                await this.zclNode.endpoints[1].clusters.onOff.writeAttributes({ powerOnBehavior: newSettings.power_on_behavior });
            } catch (error) {
                this.log("Error updating the power on behavior");
            }
        }

        // if (changedKeys.includes('switch_type')) {
        //     try {
        //         // TODO: apparently readonly?
        //         await this.zclNode.endpoints[1].clusters.onOffSwitch.writeAttributes({ switchType: newSettings.switch_type });
        //     } catch (error) {
        //         this.log("Error updating the switch type");
        //     }
        // }
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
    async onDeleted() {
        this.log("smartswitch removed");
    }

    // Show the migrate-to-socket maintenance action only for devices that
    // were paired when the driver class was "light". Once they migrate
    // (or for new pairings that already started as "socket") the capability
    // is removed so it doesn't clutter the device settings.
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

}

module.exports = SonoffZBMINIL2;
