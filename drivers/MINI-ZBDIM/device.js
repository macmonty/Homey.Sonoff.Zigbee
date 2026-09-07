'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { Cluster, CLUSTER } = require('zigbee-clusters');

const SonoffOnOffCluster = require('../../lib/SonoffOnOffCluster');
try {
  Cluster.addCluster(SonoffOnOffCluster);
} catch (err) {
  // Cluster might already be registered by another driver
}

const SonoffCluster = require('../../lib/SonoffCluster');
try {
  Cluster.addCluster(SonoffCluster);
} catch (err) {
  // Cluster might already be registered by another driver
}

const { writeAttributesVerbose } = require('../../lib/zclDebug');

class SonoffMiniZBDim extends ZigBeeDevice {

  _lastCalibrationStatus = undefined;
  _lastCalibrationProgress = undefined;

  async onNodeInit({ zclNode }) {
    this.log('MINI-ZBDIM Dimmer initialized');

    const self = this;

    if (this.hasCapability('onoff')) {
      this.registerCapability('onoff', CLUSTER.ON_OFF, {
        reportParser(value) {
          if (!value) {
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

    if (this.hasCapability('dim')) {
      this.registerCapability('dim', CLUSTER.LEVEL_CONTROL);
    }

    if (this.hasCapability('start_calibration')) {
      this.registerCapabilityListener('start_calibration', () => this.startCalibration());
    }

    // Live power measurements are exposed via Sonoff's manufacturer-specific
    // cluster (acCurrentVoltageValue/acCurrentCurrentValue/acCurrentPowerValue),
    // NOT the standard Electrical Measurement cluster — confirmed against
    // zigbee-herdsman-converters (the reference used by zigbee2mqtt). Raw
    // values are milli-units (divide by 1000).
    const sonoffMeasurementCluster = zclNode.endpoints[1].clusters[SonoffCluster.NAME];

    if (this.hasCapability('measure_voltage') && sonoffMeasurementCluster) {
      sonoffMeasurementCluster.on('attr.acCurrentVoltageValue', (value) => {
        self.setCapabilityValue('measure_voltage', value / 1000).catch(self.error);
      });
    }

    if (this.hasCapability('measure_power') && sonoffMeasurementCluster) {
      sonoffMeasurementCluster.on('attr.acCurrentPowerValue', (value) => {
        if (!self.getCapabilityValue('onoff')) return;
        self.setCapabilityValue('measure_power', value / 1000).catch(self.error);
      });
    }

    if (this.hasCapability('measure_current') && sonoffMeasurementCluster) {
      sonoffMeasurementCluster.on('attr.acCurrentCurrentValue', (value) => {
        if (!self.getCapabilityValue('onoff')) return;
        self.setCapabilityValue('measure_current', value / 1000).catch(self.error);
      });
    }

    this.pollPowerMeasurements();
    if (this._powerPollInterval) {
      this.homey.clearInterval(this._powerPollInterval);
    }
    this._powerPollInterval = this.homey.setInterval(() => {
      this.pollPowerMeasurements();
    }, 60000);

    // Read current settings from the device
    this.checkAttributes();

    // Keep settings in sync if changed physically or by the device itself
    this.registerAttributeReportListeners();
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Settings changed:', changedKeys);

    if (changedKeys.includes('power_on_behavior')) {
      try {
        await writeAttributesVerbose(this, this.zclNode.endpoints[1].clusters.onOff, {
          powerOnBehavior: newSettings.power_on_behavior,
        });
      } catch (error) {
        this.error('Error updating power on behavior:', error.message);
      }
    }

    const sonoffSettings = {};

    if (changedKeys.includes('delayed_power_on_state')) {
      sonoffSettings.power_on_delay_state = !!newSettings.delayed_power_on_state;
    }

    if (changedKeys.includes('delayed_power_on_time')) {
      // Device expects 0.5s increments
      sonoffSettings.power_on_delay_time = Math.round(newSettings.delayed_power_on_time * 2);
    }

    if (changedKeys.includes('switch_mode')) {
      sonoffSettings.switch_mode = parseInt(newSettings.switch_mode, 10);
    }

    if (changedKeys.includes('min_brightness_threshold')) {
      sonoffSettings.min_brightness_threshold = Math.round((newSettings.min_brightness_threshold * 255) / 100);
    }

    if (changedKeys.includes('max_brightness_threshold')) {
      sonoffSettings.max_brightness_threshold = Math.round((newSettings.max_brightness_threshold * 255) / 100);
    }

    if (changedKeys.includes('dimming_light_rate')) {
      sonoffSettings.dimming_light_rate = parseInt(newSettings.dimming_light_rate, 10);
    }

    if (changedKeys.includes('transition_time')) {
      // Device expects 0.1s increments
      sonoffSettings.transition_time = Math.round(newSettings.transition_time * 10);
    }

    if (Object.keys(sonoffSettings).length > 0) {
      try {
        await writeAttributesVerbose(this, this.zclNode.endpoints[1].clusters[SonoffCluster.NAME], sonoffSettings);
        this.log('SonoffCluster attributes written:', sonoffSettings);
      } catch (err) {
        this.error('Error writing SonoffCluster settings:', err.message);
      }
    }

    if (changedKeys.includes('inching_control') ||
        changedKeys.includes('inching_mode') ||
        changedKeys.includes('inching_time')) {
      await this.setInchingControl(newSettings);
    }
  }

  formatCalibrationInfo() {
    const STATUS_LABELS = ['Not calibrated', 'Calibrating…', 'Calibration failed', 'Calibrated'];
    const statusLabel = STATUS_LABELS[this._lastCalibrationStatus] || 'Unknown';
    const progress = this._lastCalibrationStatus === 1 && this._lastCalibrationProgress !== undefined
      ? ` (${this._lastCalibrationProgress}%)`
      : '';
    return `${statusLabel}${progress}`;
  }

  async startCalibration() {
    try {
      // Raw bytes [0x03, 0x01, 0x01, 0x01], no length prefix — see the
      // comment on `set_calibration_action` in lib/SonoffCluster.js for why.
      // Calibration takes ~2 minutes; the device may report unavailable meanwhile.
      const payload = Buffer.from([0x03, 0x01, 0x01, 0x01]);
      await writeAttributesVerbose(this, this.zclNode.endpoints[1].clusters[SonoffCluster.NAME], {
        set_calibration_action: payload,
      });
      this.log('Calibration started');
      await this.setSettings({ calibration_info: 'Calibrating…' });
    } catch (error) {
      this.error('Error starting calibration:', error.message || error);
      throw error;
    }
  }

  async pollPowerMeasurements() {
    const cluster = this.zclNode.endpoints[1].clusters[SonoffCluster.NAME];
    if (!cluster) return;

    try {
      const data = await cluster.readAttributes(['acCurrentVoltageValue', 'acCurrentPowerValue', 'acCurrentCurrentValue']);
      const isOn = this.getCapabilityValue('onoff');

      if (this.hasCapability('measure_voltage') && data.acCurrentVoltageValue !== undefined) {
        await this.setCapabilityValue('measure_voltage', data.acCurrentVoltageValue / 1000);
      }
      if (this.hasCapability('measure_power') && data.acCurrentPowerValue !== undefined) {
        await this.setCapabilityValue('measure_power', isOn ? data.acCurrentPowerValue / 1000 : 0);
      }
      if (this.hasCapability('measure_current') && data.acCurrentCurrentValue !== undefined) {
        await this.setCapabilityValue('measure_current', isOn ? data.acCurrentCurrentValue / 1000 : 0);
      }
    } catch (e) {
      this.log('Could not read power measurements:', e.message);
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

  async checkAttributes() {
    try {
      const data = await this.zclNode.endpoints[1].clusters.onOff.readAttributes(['powerOnBehavior']);
      if (data && data.powerOnBehavior !== undefined) {
        await this.setSettings({ power_on_behavior: data.powerOnBehavior });
      }
    } catch (e) {
      this.log('Device offline at startup, skipping attribute sync:', e.message);
      return;
    }

    const attrsToRead = [
      'switch_mode',
      'min_brightness_threshold',
      'max_brightness_threshold',
      'dimming_light_rate',
      'transition_time',
      'power_on_delay_state',
      'power_on_delay_time',
      'calibration_status',
      'calibration_progress',
    ];

    try {
      const data = await this.zclNode.endpoints[1].clusters[SonoffCluster.NAME].readAttributes(attrsToRead);
      if (!data) return;

      const settingsData = {};
      if (data.switch_mode !== undefined) settingsData.switch_mode = String(data.switch_mode);
      if (data.dimming_light_rate !== undefined) settingsData.dimming_light_rate = String(data.dimming_light_rate);
      if (data.min_brightness_threshold !== undefined) settingsData.min_brightness_threshold = Math.round((data.min_brightness_threshold * 100) / 255);
      if (data.max_brightness_threshold !== undefined) settingsData.max_brightness_threshold = Math.round((data.max_brightness_threshold * 100) / 255);
      if (data.transition_time !== undefined) settingsData.transition_time = data.transition_time / 10;
      if (data.power_on_delay_state !== undefined) settingsData.delayed_power_on_state = !!data.power_on_delay_state;
      if (data.power_on_delay_time !== undefined) settingsData.delayed_power_on_time = data.power_on_delay_time / 2;
      if (data.calibration_status !== undefined) this._lastCalibrationStatus = data.calibration_status;
      if (data.calibration_progress !== undefined) this._lastCalibrationProgress = data.calibration_progress;
      if (data.calibration_status !== undefined || data.calibration_progress !== undefined) {
        settingsData.calibration_info = this.formatCalibrationInfo();
      }

      if (Object.keys(settingsData).length > 0) {
        await this.setSettings(settingsData);
      }
    } catch (e) {
      this.log('Could not read SonoffCluster attributes:', e.message);
    }
  }

  registerAttributeReportListeners() {
    const onOffCluster = this.zclNode.endpoints[1].clusters.onOff;
    if (onOffCluster) {
      onOffCluster.on('attr.powerOnBehavior', (value) => {
        if (this.getSetting('power_on_behavior') !== value) {
          this.setSettings({ power_on_behavior: value }).catch(this.error);
        }
      });
    }

    const sonoffCluster = this.zclNode.endpoints[1].clusters[SonoffCluster.NAME];
    if (sonoffCluster) {
      sonoffCluster.on('attr.switch_mode', (value) => {
        const valStr = String(value);
        if (this.getSetting('switch_mode') !== valStr) {
          this.setSettings({ switch_mode: valStr }).catch(this.error);
        }
      });
      sonoffCluster.on('attr.dimming_light_rate', (value) => {
        const valStr = String(value);
        if (this.getSetting('dimming_light_rate') !== valStr) {
          this.setSettings({ dimming_light_rate: valStr }).catch(this.error);
        }
      });
      sonoffCluster.on('attr.min_brightness_threshold', (value) => {
        const valPct = Math.round((value * 100) / 255);
        if (this.getSetting('min_brightness_threshold') !== valPct) {
          this.setSettings({ min_brightness_threshold: valPct }).catch(this.error);
        }
      });
      sonoffCluster.on('attr.max_brightness_threshold', (value) => {
        const valPct = Math.round((value * 100) / 255);
        if (this.getSetting('max_brightness_threshold') !== valPct) {
          this.setSettings({ max_brightness_threshold: valPct }).catch(this.error);
        }
      });
      sonoffCluster.on('attr.transition_time', (value) => {
        const valSec = value / 10;
        if (this.getSetting('transition_time') !== valSec) {
          this.setSettings({ transition_time: valSec }).catch(this.error);
        }
      });
      sonoffCluster.on('attr.power_on_delay_state', (value) => {
        if (this.getSetting('delayed_power_on_state') !== !!value) {
          this.setSettings({ delayed_power_on_state: !!value }).catch(this.error);
        }
      });
      sonoffCluster.on('attr.power_on_delay_time', (value) => {
        const valSec = value / 2;
        if (this.getSetting('delayed_power_on_time') !== valSec) {
          this.setSettings({ delayed_power_on_time: valSec }).catch(this.error);
        }
      });

      sonoffCluster.on('attr.calibration_status', (value) => {
        this._lastCalibrationStatus = value;
        this.setSettings({ calibration_info: this.formatCalibrationInfo() }).catch(this.error);
      });
      sonoffCluster.on('attr.calibration_progress', (value) => {
        this._lastCalibrationProgress = value;
        this.setSettings({ calibration_info: this.formatCalibrationInfo() }).catch(this.error);
      });
    }
  }

  async onDeleted() {
    this.log('MINI-ZBDIM Dimmer removed');
  }

}

module.exports = SonoffMiniZBDim;
