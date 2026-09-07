'use strict';

const { ZigBeeDevice } = require("homey-zigbeedriver");

const SonoffOnOffCluster = require("../../lib/SonoffOnOffCluster");
const { Cluster, CLUSTER, BoundCluster } = require('zigbee-clusters');
Cluster.addCluster(SonoffOnOffCluster);

const SonoffCluster = require("../../lib/SonoffCluster");
Cluster.addCluster(SonoffCluster);

const SonoffBase = require('../sonoffbase');

class MyOnOffBoundCluster extends BoundCluster {
    constructor(node) {
        super();
        this.node = node;
        this._click = node.homey.flow.getDeviceTriggerCard("ZBMINIR2:click");
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

class SonoffZBMINIR2 extends SonoffBase {

 /**
   * onInit is called when the device is initialized.
   */
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

        // Handle turbo_mode conversion: true=20 (on), false=9 (off)
        if (changedKeys.includes("turbo_mode")) {
            newSettings.turbo_mode = newSettings.turbo_mode ? 20 : 9;
        }

        this.writeAttributes(SonoffCluster, newSettings, changedKeys).catch(this.error);       
  }

  async checkAttributes() {
    
    this.readAttribute(CLUSTER.ON_OFF, ['powerOnBehavior'], (data) => {
        this.setSettings({ power_on_behavior: data.powerOnBehavior }).catch(this.error); //, switch_type: switchType });
    });
    
    this.readAttribute(SonoffCluster, SonoffClusterAttributes, (data) => {
        // Convert turbo_mode device value to boolean: 20=true (on), 9=false (off)
        if (data.turbo_mode !== undefined) {
            data.turbo_mode = data.turbo_mode === 20;
        }
        this.setSettings(data).catch(this.error);
    });
    
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
    async onDeleted() {
        this.log("smartswitch removed");
    }

}

module.exports = SonoffZBMINIR2;
