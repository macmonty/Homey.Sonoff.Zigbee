'use strict';

const Homey = require('homey');
const SonoffBase = require('./sonoffbase');
const { debug, CLUSTER, Cluster } = require('zigbee-clusters');
const SonoffCluster = require('../lib/SonoffCluster');

let sonoffClusterAvailable = false;
try {
	Cluster.addCluster(SonoffCluster);
	sonoffClusterAvailable = true;
} catch (err) {
	console.log('SonoffCluster not available, offset features will be disabled');
}

class TempHumiditySensor2 extends SonoffBase {

	async onNodeInit({zclNode}) {

		super.onNodeInit(...arguments);

		if (this.isFirstInit()) {
			await this._configureReporting(zclNode).catch(err => {
				this.error('failed to register attr report listener', err);
			});
		}
		
		// Try to read initial offset values from device and sync with settings
		try {
			await this.syncOffsetSettings();
		} catch (err) {
			this.log('Failed to sync offset settings from device:', err.message);
		}
		
		// measure_temperature
		zclNode.endpoints[1].clusters[CLUSTER.TEMPERATURE_MEASUREMENT.NAME]
		.on('attr.measuredValue', this.onTemperatureMeasuredAttributeReport.bind(this));

		// measure_humidity
		if (zclNode.endpoints[1].clusters[CLUSTER.RELATIVE_HUMIDITY_MEASUREMENT.NAME]) {
			zclNode.endpoints[1].clusters[CLUSTER.RELATIVE_HUMIDITY_MEASUREMENT.NAME]
			.on('attr.measuredValue', this.onRelativeHumidityMeasuredAttributeReport.bind(this));
		}
	}

	// Called by the framework when the device sends an endDeviceAnnounce
	// (e.g. after a battery change, deep sleep, or losing then regaining
	// its Zigbee uplink). Without re-configuring reporting here, Sonoff
	// SNZB-02 sensors often stop sending data and require re-pairing.
	// Based on the approach used by Johan Bendz's tech.sonoff app.
	async onEndDeviceAnnounce() {
		this.log('endDeviceAnnounce — re-syncing availability and reporting config');
		try {
			if (!this.getAvailable()) {
				await this.setAvailable();
			}
		} catch (err) {
			this.error('Failed to set device available on re-announce', err);
		}
		try {
			await this._configureReporting();
		} catch (err) {
			this.error('Failed to re-configure reporting on endDeviceAnnounce', err);
		}
	}

	async _configureReporting(zclNode) {
		const node = zclNode || this.zclNode;
		const tempDecimals  = parseInt(this.getSetting('temperature_decimals') || '1');
		const humDecimals   = parseInt(this.getSetting('humidity_decimals')    || '0');
		const maxInterval   = parseInt(this.getSetting('reporting_interval')   || '90');
		const tempMinChange = Math.pow(10, 2 - tempDecimals); // 0dec=100, 1dec=10, 2dec=1
		const humMinChange  = Math.pow(10, 2 - humDecimals);

		const reportingConfigs = [
			{
				endpointId: 1,
				cluster: CLUSTER.TEMPERATURE_MEASUREMENT,
				attributeName: 'measuredValue',
				minInterval: 0,
				maxInterval,
				minChange: tempMinChange,
			},
		];

		if (node.endpoints[1].clusters[CLUSTER.RELATIVE_HUMIDITY_MEASUREMENT.NAME]) {
			reportingConfigs.push({
				endpointId: 1,
				cluster: CLUSTER.RELATIVE_HUMIDITY_MEASUREMENT,
				attributeName: 'measuredValue',
				minInterval: 0,
				maxInterval,
				minChange: humMinChange,
			});
		}

		await this.configureAttributeReporting(reportingConfigs);
		this.log(`Reporting configured: maxInterval=${maxInterval}s tempMinChange=${tempMinChange} humMinChange=${humMinChange}`);
	}

	async syncOffsetSettings() {
		if (!sonoffClusterAvailable || !this.zclNode.endpoints[1].clusters[SonoffCluster.NAME]) {
			this.log('SonoffCluster not available, skipping offset sync');
			return;
		}

		try {
			// Read offset values from device
			const attributes = await this.zclNode.endpoints[1].clusters[SonoffCluster.NAME].readAttributes(
				'temperature_offset',
				'humidity_offset'
			);

			let settingsToUpdate = {};

			// Sync temperature offset
			if (attributes.temperature_offset !== undefined) {
				const deviceTempOffset = attributes.temperature_offset / 100;
				const currentTempOffset = this.getSetting('temperature_offset') || 0;
				
				if (deviceTempOffset !== currentTempOffset) { // Allow small tolerance
					settingsToUpdate.temperature_offset = deviceTempOffset;
					this.log('Syncing temperature offset from device:', deviceTempOffset);
				}
			}

			// Sync humidity offset (only if device supports humidity)
			if (attributes.humidity_offset !== undefined && this.hasCapability('measure_humidity')) {
				const deviceHumidityOffset = attributes.humidity_offset / 100;
				const currentHumidityOffset = this.getSetting('humidity_offset') || 0;
				
				if (deviceHumidityOffset !== currentHumidityOffset) {
					settingsToUpdate.humidity_offset = deviceHumidityOffset;
					this.log('Syncing humidity offset from device:', deviceHumidityOffset);
				}
			}

			// Update settings if needed
			if (Object.keys(settingsToUpdate).length > 0) {
				await this.setSettings(settingsToUpdate);
			}

		} catch (err) {
			this.log('Offset attributes not supported on this device, skipping sync');
		}
	}

	_parseReportedValue(measuredValue, decimalsKey) {
		const d = parseInt(this.getSetting(decimalsKey) || '1');
		const factor = Math.pow(10, d);
		return Math.round((measuredValue / 100) * factor) / factor;
	}

	onTemperatureMeasuredAttributeReport(measuredValue) {
		const parsedValue = this._parseReportedValue(measuredValue, 'temperature_decimals');
		this.setCapabilityValue('measure_temperature', parsedValue).catch(this.error);
	}

	onRelativeHumidityMeasuredAttributeReport(measuredValue) {
		if (this.hasCapability('measure_humidity')) {
			const parsedValue = this._parseReportedValue(measuredValue, 'humidity_decimals');
			this.setCapabilityValue('measure_humidity', parsedValue).catch(this.error);
		}
	}

	async onSettings({ oldSettings, newSettings, changedKeys }) {
		if (changedKeys.includes('temperature_decimals') || changedKeys.includes('humidity_decimals') || changedKeys.includes('reporting_interval')) {
			await this._configureReporting().catch(err => this.error('failed to reconfigure reporting', err));
		}

		if (!sonoffClusterAvailable || !this.zclNode.endpoints[1].clusters[SonoffCluster.NAME]) {
			this.log('SonoffCluster not available, offset settings cannot be applied to device');
			
			// Show notification about re-adding device for offset features
			this.homey.notifications.createNotification({
				excerpt: `${this.getName()}: Re-add device to enable offset calibration features.`
			}).catch(err => {
				this.error('Failed to create notification:', err);
			});
			
			return super.onSettings({ oldSettings, newSettings, changedKeys });
		}

		// Handle settings changes for temperature and humidity offsets
		// Write the offset values to the device's SonoffCluster attributes
		
		if (changedKeys.includes('temperature_offset')) {
			try {
				const tempOffset = Math.round(newSettings.temperature_offset * 100); // Convert to device format (0.1°C steps)
				await this.zclNode.endpoints[1].clusters[SonoffCluster.NAME].writeAttributes({
					temperature_offset: tempOffset
				});
				this.log('Temperature offset written to device:', tempOffset);
			} catch (err) {
				this.error('Failed to write temperature offset to device:', err);
				throw err;
			}
		}

		if (changedKeys.includes('humidity_offset')) {
			try {
				const humidityOffset = Math.round(newSettings.humidity_offset * 100); // Convert to device format (1% steps)
				await this.zclNode.endpoints[1].clusters[SonoffCluster.NAME].writeAttributes({
					humidity_offset: humidityOffset
				});
				this.log('Humidity offset written to device:', humidityOffset);
			} catch (err) {
				this.error('Failed to write humidity offset to device:', err);
				throw err;
			}
		}

		return super.onSettings({ oldSettings, newSettings, changedKeys });
	}

}

module.exports = TempHumiditySensor2;