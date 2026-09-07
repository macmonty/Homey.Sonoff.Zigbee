'use strict';

const Homey = require('homey');
const SonoffBase = require('../sonoffbase');
const { Cluster, ZCLDataTypes, ZCLDataType, CLUSTER, BoundCluster, ThermostatCluster } = require('zigbee-clusters');
const { ZCLStandardHeader } = require('zigbee-clusters/lib/zclFrames');
const SonoffCluster = require("../../lib/SonoffCluster");

Cluster.addCluster(SonoffCluster);

const Attributes = [
	'measuredValue'
];

class SonoffSWV extends SonoffBase {

	async onNodeInit({ zclNode }) {
		super.onNodeInit({ zclNode }, {noAttribCheck:false});
		
		this.registerCapability('onoff', CLUSTER.ON_OFF);	

		// Initialize total water usage tracking
		if (!this.hasCapability('meter_water')) {
			await this.addCapability('meter_water');
		}
		
		// Initialize the total water usage if not already set
		if (this.getCapabilityValue('meter_water') === null || this.getCapabilityValue('meter_water') === undefined) {
			await this.setCapabilityValue('meter_water', 0);
		}

		// Store the last measurement time for calculating consumption
		this.lastMeasurementTime = Date.now();
		this.lastFlowRate = 0;
		this.isUpdatingWaterFlow = false;
		this.waterFlowTimer = null;
		this.totalWaterUsageM3 = this.getCapabilityValue('meter_water') || 0; // Store locally in m³

		// Configure flow measurement attribute reporting
		//if (this.isFirstInit()) {
			await this.configureAttributeReporting([
				{
					endpointId: 1,
					cluster: CLUSTER.FLOW_MEASUREMENT,
					attributeName: 'measuredValue',
					minInterval: 1,
					maxInterval: 300,
					minChange: 1
				}
			]).then(() => {
				this.log('Configured flow measurement attribute reporting');
			}).catch(err => {
				this.error('Failed to configure flow measurement reporting:', err);
			});
		//}

		// Set up flow measurement attribute listener
		if (zclNode.endpoints[1].clusters[CLUSTER.FLOW_MEASUREMENT.NAME]) {
			zclNode.endpoints[1].clusters[CLUSTER.FLOW_MEASUREMENT.NAME]
				.on('attr.measuredValue', this.onFlowMeasuredAttributeReport.bind(this));
		}

		this.log('Sonoff SWV device initialized');

		// Start periodic check for reset setting
		this.startResetCheck();
	}

	onFlowMeasuredAttributeReport(measuredValue) {
		// Calculate and update water usage
		this.updateWaterFlow(measuredValue); 
		
		this.log('Flow measurement report:', measuredValue);
	}

	updateWaterFlow(measuredValue) {
		// Prevent multiple simultaneous executions
		if (this.isUpdatingWaterFlow) {
			return;
		}
		
		this.isUpdatingWaterFlow = true;
		
		try {
			// Convert flow measurement to liters per minute
			const litersPerMinute = measuredValue * 1000 / 600;

			// Log the flow rate for debugging
			this.log('Flow rate:', litersPerMinute.toFixed(2), 'L/min');
			
			// Set the current flow rate capability
			this.setCapabilityValue('measure_water', litersPerMinute).catch(this.error);
			
			// Calculate water consumption since last measurement
			const currentTime = Date.now();
			const timeDifferenceMinutes = (currentTime - this.lastMeasurementTime) / 60000;
			
			if (timeDifferenceMinutes > 0 && this.lastFlowRate > 0) {
				// Calculate water consumed = average flow rate * time
				const averageFlowRate = (this.lastFlowRate + litersPerMinute) / 2;
				const waterConsumedLiters = averageFlowRate * timeDifferenceMinutes;
				
				// Add directly to local meter value (convert to m³)
				this.totalWaterUsageM3 += (waterConsumedLiters / 1000);
				
				// Update capability with rounded value
				const roundedTotal = Math.round(this.totalWaterUsageM3 * 10000) / 10000; // Round to 4 decimal places
				this.setCapabilityValue('meter_water', roundedTotal).catch(this.error);
				
				this.log('Water consumed:', waterConsumedLiters.toFixed(3), 'L, Total usage:', roundedTotal.toFixed(4), 'm³');
			}
			
			// Update tracking variables
			this.lastMeasurementTime = currentTime;
			this.lastFlowRate = litersPerMinute;
			
			// Clear existing timer
			if (this.waterFlowTimer) {
				clearTimeout(this.waterFlowTimer);
				this.waterFlowTimer = null;
			}
			
			// If water is flowing, set up timer for next update
			if (litersPerMinute > 0) {
				this.waterFlowTimer = setTimeout(() => {
					this.updateWaterFlow(measuredValue);
				}, 2000); // Update every 10 seconds while water is flowing
			}
		} finally {
			this.isUpdatingWaterFlow = false;
		}
	}

	async checkAttributes() {
		this.readAttribute(CLUSTER.FLOW_MEASUREMENT, Attributes, (data) => {
			this.log('Flow Measurement Attributes:', data);
			
			// Calculate and update water usage
			this.updateWaterFlow(data.measuredValue); 
		});
	}

	// Method to reset water meter (useful for maintenance)
	async resetWaterMeter() {
		this.totalWaterUsageM3 = 0;
		await this.setCapabilityValue('meter_water', 0);
		this.log('Water meter reset to 0');
	}

	startResetCheck() {
		this.resetCheckInterval = setInterval(async () => {
			try {
				const settings = this.getSettings();
				if (settings.reset_water_meter === true) {
					await this.resetWaterMeter();
					await this.setSettings({ reset_water_meter: false });
					this.log('Reset water meter setting cleared');
				}
			} catch (err) {
				this.error('Error checking reset setting:', err);
			}
		}, 10000); // Check every second
	}

	onDeleted() {
		if (this.resetCheckInterval) {
			clearInterval(this.resetCheckInterval);
		}
		if (this.waterFlowTimer) {
			clearTimeout(this.waterFlowTimer);
		}
		super.onDeleted && super.onDeleted();
	}
}

module.exports = SonoffSWV;
