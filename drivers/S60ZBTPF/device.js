'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { Cluster, CLUSTER } = require('zigbee-clusters');

const SonoffOnOffCluster = require('../../lib/SonoffOnOffCluster');
Cluster.addCluster(SonoffOnOffCluster);

const SonoffCluster = require('../../lib/SonoffCluster');

try {
  Cluster.addCluster(SonoffCluster);
} catch (err) {
  // Cluster might already be registered by another driver
}

const SonoffTimeBoundCluster = require('../../lib/SonoffTimeBoundCluster');

class SonoffS60ZBTPF extends ZigBeeDevice {

  async onNodeInit({ zclNode }) {
    this.log('S60ZBTPF device initialized');

    const self = this;

    // Serve time to device so it can track daily/monthly energy
    zclNode.endpoints[1].bind('time', new SonoffTimeBoundCluster(zclNode.endpoints[1]));

    // Read initial settings
    this.readSettings();

    if (this.hasCapability('onoff')) {
      this.registerCapability('onoff', CLUSTER.ON_OFF, {
        getOpts: {
          getOnOnline: true,
          getOnStart: true,
          pollInterval: 60000
        },
        reportOpts: {
          configureAttributeReporting: {
            minInterval: 1,
            maxInterval: 300,
          },
        },
        reportParser(value) {
          // Reset power and current when device is turned off
          if (!value) {
            self.log('Device turned off, resetting power and current to 0');
            if (self.hasCapability('measure_power')) {
              self.setCapabilityValue('measure_power', 0).catch(self.error);
            }
            if (self.hasCapability('measure_current')) {
              self.setCapabilityValue('measure_current', 0).catch(self.error);
            }
          }
          return value;
        },
      });
    }

    if (this.hasCapability('measure_voltage')) {
      this.registerCapability('measure_voltage', CLUSTER.ELECTRICAL_MEASUREMENT, {
        get: 'rmsVoltage',
        report: 'rmsVoltage',
        reportParser(value) {
          const result = value / 100;
          this.log(`Voltage raw: ${value}, parsed: ${result}V`);
          return result;
        },
        getParser(value) {
          return value / 100;
        },
        getOpts: {
          getOnOnline: true,
          getOnStart: true,
          pollInterval: 60000
        },
        reportOpts: {
          configureAttributeReporting: {
            minInterval: 1,
            maxInterval: 300,
            minChange: 500, // 5V in raw units (divisor 100), matches zigbee2mqtt
          },
        },
      });
    }

    if (this.hasCapability('measure_power')) {
      this.registerCapability('measure_power', CLUSTER.ELECTRICAL_MEASUREMENT, {
        get: 'activePower',
        report: 'activePower',
        reportParser(value) {
          if (!self.getCapabilityValue('onoff')) return 0;
          if (value === 0 && self.hasCapability('measure_current')) {
            self.setCapabilityValue('measure_current', 0).catch(self.error);
          }
          return value;
        },
        getParser(value) {
          if (!self.getCapabilityValue('onoff')) return 0;
          return value;
        },
        getOpts: {
          getOnOnline: true,
          getOnStart: true,
          pollInterval: 60000
        },
        reportOpts: {
          configureAttributeReporting: {
            minInterval: 1,
            maxInterval: 300,
            minChange: 5, // 5W, matches zigbee2mqtt
          },
        },
      });
    }

    if (this.hasCapability('measure_current')) {
      this.registerCapability('measure_current', CLUSTER.ELECTRICAL_MEASUREMENT, {
        get: 'rmsCurrent',
        report: 'rmsCurrent',
        reportParser(value) {
          if (!self.getCapabilityValue('onoff')) return 0;
          return value / 100;
        },
        getParser(value) {
          if (!self.getCapabilityValue('onoff')) return 0;
          return value / 100;
        },
        getOpts: {
          getOnOnline: true,
          getOnStart: true,
          pollInterval: 60000
        },
        reportOpts: {
          configureAttributeReporting: {
            minInterval: 1,
            maxInterval: 300,
            minChange: 5, // 0.05A in raw units (divisor 100), matches zigbee2mqtt
          },
        },
      });
    }

    // Configure attribute reporting for energy - device pushes updates automatically
    try {
      await this.configureAttributeReporting([
        { endpointId: 1, cluster: SonoffCluster, attributeName: 'energy_today',     minInterval: 30, maxInterval: 3600, minChange: 10 },
        { endpointId: 1, cluster: SonoffCluster, attributeName: 'energy_yesterday', minInterval: 30, maxInterval: 3600, minChange: 10 },
        { endpointId: 1, cluster: SonoffCluster, attributeName: 'energy_month',     minInterval: 30, maxInterval: 3600, minChange: 10 },
      ]);
      this.log('Configured energy attribute reporting (min=30s, max=3600s, minChange=10Wh)');
    } catch (err) {
      this.log('Could not configure energy reporting, falling back to polling:', err.message);
    }

    // Ensure cumulative meter_power capability exists on devices paired
    // before v1.13.0 (when this was added). The capability is required for
    // the device to show up in Homey's Energy dashboard.
    if (!this.hasCapability('meter_power')) {
      this.addCapability('meter_power').catch(this.error);
    }

    // Listen for energy attribute reports pushed by the device
    zclNode.endpoints[1].clusters[SonoffCluster.NAME].on('attr.energy_today', value => {
      const newTodayKwh = Number(value) / 1000;
      if (this.hasCapability('meter_power_today')) {
        this.setCapabilityValue('meter_power_today', newTodayKwh).catch(this.error);
      }
      this._updateCumulativeMeterPower(newTodayKwh).catch(this.error);
    });
    zclNode.endpoints[1].clusters[SonoffCluster.NAME].on('attr.energy_yesterday', value => {
      if (this.hasCapability('meter_power_yesterday')) {
        this.setCapabilityValue('meter_power_yesterday', Number(value) / 1000).catch(this.error);
      }
    });
    zclNode.endpoints[1].clusters[SonoffCluster.NAME].on('attr.energy_month', value => {
      if (this.hasCapability('meter_power_month')) {
        this.setCapabilityValue('meter_power_month', Number(value) / 1000).catch(this.error);
      }
    });

    // Poll energy values periodically as fallback - clear any existing interval first to avoid duplicates on reconnect
    if (this._energyPollInterval) {
      this.homey.clearInterval(this._energyPollInterval);
    }
    this.pollEnergy();
    this._energyPollInterval = this.homey.setInterval(() => {
      this.pollEnergy();
    }, 60000 * 5); // Every 5 minutes fallback
  }

  async pollEnergy() {
    try {
      const cluster = this.zclNode.endpoints[1].clusters[SonoffCluster.NAME];
      if (!cluster) {
        this.log('SonoffCluster not available on endpoint 1, skipping energy poll');
        return;
      }

      // Read energy attributes (manufacturer-specific: requires manufacturerId 0x1286 in ZCL frame)
      let energyToday, energyYesterday, energyMonth;

      try {
        const result = await cluster.readAttributes('energy_today', 'energy_yesterday', 'energy_month');
        energyToday = result.energy_today;
        energyYesterday = result.energy_yesterday;
        energyMonth = result.energy_month;
      } catch (err) {
        this.log('Could not read energy attributes:', err.message);
      }

      // Values from device are in Wh units, divide by 1000 to get kWh
      if (energyToday !== undefined && energyToday !== null) {
        const newTodayKwh = Number(energyToday) / 1000;
        if (this.hasCapability('meter_power_today')) {
          await this.setCapabilityValue('meter_power_today', newTodayKwh);
        }
        await this._updateCumulativeMeterPower(newTodayKwh);
      }
      if (energyYesterday !== undefined && energyYesterday !== null && this.hasCapability('meter_power_yesterday')) {
        await this.setCapabilityValue('meter_power_yesterday', Number(energyYesterday) / 1000);
      }
      if (energyMonth !== undefined && energyMonth !== null && this.hasCapability('meter_power_month')) {
        await this.setCapabilityValue('meter_power_month', Number(energyMonth) / 1000);
      }
    } catch (error) {
      this.error('Error polling energy:', error);
    }
  }

  // Builds a strictly-increasing total kWh counter from the device's daily
  // counter (which resets at midnight). Homey Energy requires a cumulative
  // meter_power that never decreases. State is persisted via setStoreValue
  // so app restarts don't lose the running total.
  async _updateCumulativeMeterPower(newTodayKwh) {
    if (!Number.isFinite(newTodayKwh)) return;
    const lastTodayKwh = this.getStoreValue('lastTodayKwh');
    const cumulative = this.getStoreValue('cumulativeKwh') ?? 0;

    let delta;
    if (lastTodayKwh === null || lastTodayKwh === undefined) {
      // First reading after install or app upgrade — anchor without backfilling.
      delta = 0;
    } else if (newTodayKwh >= lastTodayKwh) {
      delta = newTodayKwh - lastTodayKwh;
    } else {
      // Device reset its daily counter (midnight). Treat the new reading as
      // the delta since the rollover.
      delta = newTodayKwh;
    }

    const newCumulative = cumulative + delta;
    await this.setStoreValue('lastTodayKwh', newTodayKwh).catch(this.error);
    if (delta > 0 || cumulative === 0) {
      await this.setStoreValue('cumulativeKwh', newCumulative).catch(this.error);
    }
    if (this.hasCapability('meter_power')) {
      await this.setCapabilityValue('meter_power', newCumulative).catch(this.error);
    }
  }

  async readSettings() {
    // Read power on behavior - SonoffOnOffCluster extends OnOffCluster with powerOnBehavior
    try {
      const cluster = this.zclNode.endpoints[1].clusters.onOff;
      if (cluster) {
        const result = await cluster.readAttributes(['powerOnBehavior']);
        this.log('Power on behavior:', result.powerOnBehavior);
        if (result.powerOnBehavior !== undefined) {
          await this.setSettings({ power_on_behavior: result.powerOnBehavior });
        }
      }
    } catch (error) {
      this.error('Error reading power on behavior:', error);
    }
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Settings changed:', changedKeys);

    if (changedKeys.includes('power_on_behavior')) {
      try {
        const cluster = this.zclNode.endpoints[1].clusters.onOff;
        if (cluster) {
          await cluster.writeAttributes({
            powerOnBehavior: newSettings.power_on_behavior
          });
          this.log('Power on behavior set to:', newSettings.power_on_behavior);
        }
      } catch (error) {
        this.error('Error setting power on behavior:', error);
      }
    }

    // Handle inching settings
    if (changedKeys.includes('inching_control') ||
        changedKeys.includes('inching_mode') ||
        changedKeys.includes('inching_time')) {
      await this.setInchingControl(newSettings);
    }
  }

  async setInchingControl(settings) {
    try {
      const enabled = settings.inching_control || false;
      const mode = settings.inching_mode || 'off';
      const time = settings.inching_time || 0.5;

      const payload = SonoffCluster.createInchingPayload(enabled, mode, time);
      this.log('Setting inching control:', { enabled, mode, time, payload: payload.toString('hex') });

      await this.zclNode.endpoints[1].clusters[SonoffCluster.NAME].setInching({ data: payload });
      this.log('Inching control set successfully');
    } catch (error) {
      this.error('Error setting inching control:', error);
    }
  }

}

module.exports = SonoffS60ZBTPF;
