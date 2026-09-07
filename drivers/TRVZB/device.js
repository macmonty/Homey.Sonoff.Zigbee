'use strict';

const Homey = require('homey');
const SonoffBase = require('../sonoffbase');
//const { ZigBeeDevice } = require('homey-zigbeedriver');
const { Cluster, CLUSTER } = require('zigbee-clusters');
const SonoffCluster = require("../../lib/SonoffCluster");
const SonoffTimeBoundCluster = require('../../lib/SonoffTimeBoundCluster');

Cluster.addCluster(SonoffCluster);

const Settings_Attributes = [
	'child_lock',
	'open_window',
	'frost_protection_temperature'
];

class SonoffTRVZB extends SonoffBase {

	async onNodeInit({ zclNode }) {

		super.onNodeInit({ zclNode }, {noAttribCheck:false});

		if (!this.hasCapability('onoff')) { //Add onoff capability if not already added
			await this.addCapability('onoff');
        }
		
		this.registerCapability('onoff', CLUSTER.ON_OFF);		
		this.registerCapabilityListener("onoff", async (value, opts) => {
			await this.writeAttributes(CLUSTER.THERMOSTAT, {
				systemMode: value ? 4 : 0 // Assuming 4 is 'on/heat' and 0 is 'off'
			});
			/*return this.setClusterCapabilityValue("onoff", CLUSTER.ON_OFF, value, opts)
			.catch(err => {
				this.error(`Error: failed to set cluster capability value (capability: "onoff", cluster: ${CLUSTER.ON_OFF.NAME}, value: ${value})`, err);
			});		
			*/	
		});

		if (this.isFirstInit()) {

			/*
			await this.configureAttributeReporting([
				{
					endpointId: 1,
					cluster: CLUSTER.THERMOSTAT,
					attributeName: 'localTemperature',	//localTemp/localTemperature
					minInterval: 0,
					maxInterval: 3600,
					minChange: 10
				},
				{
					endpointId: 1,
					cluster: CLUSTER.THERMOSTAT,
					attributeName: 'occupiedHeatingSetpoint',
					minInterval: 0,
					maxInterval: 3600,
					minChange: 10
				},
				{
					endpointId: 1,
					cluster: CLUSTER.THERMOSTAT,
					attributeName: 'localTemperatureCalibration',
					minInterval: 0,
					maxInterval: 3600,
					minChange: 10
				},
				...Settings_Attributes.map( (value) => {
					return {
						endpointId: 1,
						cluster: SonoffCluster,
						attributeName: value,
						minInterval: 0,
						maxInterval: 3600
					}
				})
			]).then(() => {
                this.log('registered attr report listener');
            })
            .catch(err => {
                this.error('failed to register attr report listener', err);
            });
			*/
			
		}

		zclNode.endpoints[1].bind('time', new SonoffTimeBoundCluster(zclNode.endpoints[1]));
		/*
		const oldHandleFrame = zclNode.endpoints[1].handleFrame.bind(zclNode.endpoints[1]);
		zclNode.endpoints[1].handleFrame = async (clusterId, frame, meta) => {
			const response = await oldHandleFrame(clusterId, frame, meta);
		};
		*/

		//await zclNode.endpoints[1].bind(CLUSTER.THERMOSTAT.NAME, new TRVThermostatCluster(this));

		this.registerCapability("measure_temperature", CLUSTER.THERMOSTAT, {
			report: 'localTemperature',
			reportParser: value => value / 100,
			get: 'localTemperature',
			getParser: value => value / 100
		});

		this.registerCapability("target_temperature", CLUSTER.THERMOSTAT, {
			report: 'occupiedHeatingSetpoint',
			reportParser: value => value / 100,
			get: 'occupiedHeatingSetpoint',
			getParser: value => value / 100,
			//set: 'occupiedHeatingSetpoint',  //Not working, use listener belove
			//setParser: value => value * 100
		});

		//When change in Homey
		this.registerCapabilityListener("target_temperature", async (value) => {
			this.writeAttributes(CLUSTER.THERMOSTAT, {
				occupiedHeatingSetpoint: value * 100
			});
		});
		
		zclNode.endpoints[1].clusters[CLUSTER.THERMOSTAT.NAME]
			.on('attr.localTemperatureCalibration', (value) => {
				this.setSettings({ localTemperatureCalibration: value }).catch(this.error);
		});

		Settings_Attributes.forEach( (attr) => {
			zclNode.endpoints[1].clusters[SonoffCluster.NAME]
            .on('attr.' + attr, (value) => {
				var o = {}
				o[attr]=value;
				this.setSettings(o).catch(this.error);
			});
		});

		this.checkAttributes();

		// Additional initialization code can be added here
		this.log('Sonoff TRVZB device initialized');
	}

	async setSettings(settings) {
		Object.entries(settings).forEach(([key, value]) => {
			if (key=="localTemperatureCalibration") {
				settings[key] = value / 100;
			} else if (key.includes("temperature")) {  //Accept t/Temperature
				settings[key] = value / 100;
			}
		});	
		await super.setSettings(settings);
	}
	
	async onSettings({ oldSettings, newSettings, changedKeys }) {
		const sonoffChangedKeys = changedKeys.filter(k => Settings_Attributes.includes(k));
		if (sonoffChangedKeys.length > 0) {
			const changedAttributes = sonoffChangedKeys.reduce((acc, key) => {
				acc[key] = newSettings[key];
				if (key.includes("temperature"))
					acc[key] = acc[key] * 100;
				return acc;
			}, {});
			await this.writeAttributes(SonoffCluster, changedAttributes);
		}

		if (changedKeys.includes('localTemperatureCalibration')) {
			await this.writeAttributes(CLUSTER.THERMOSTAT, { localTemperatureCalibration: newSettings.localTemperatureCalibration * 10 });
		}
	}

	async checkAttributes() {
		this.readAttribute(SonoffCluster, Settings_Attributes, (data) => {
			this.setSettings(data).catch(this.error);
		});
		this.readAttribute(CLUSTER.THERMOSTAT, ['localTemperatureCalibration'], (data) => {
			this.setSettings(data).catch(this.error);
		});
	}

}

module.exports = SonoffTRVZB;

/*
Bindings
1,
1026,
513,
6,
10

Clusters
0,
1,
1026,
513,
6,
10,
64529
*/