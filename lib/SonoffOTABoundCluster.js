'use strict';

const { Cluster, BoundCluster } = require('zigbee-clusters');
const https = require('https');

const OTA_CLUSTER_ID = 25; // 0x0019
const OTA_INDEX_URL  = 'https://raw.githubusercontent.com/Koenkk/zigbee-OTA/master/index.json';

// Module-level firmware cache keyed by url
const firmwareCache = {};

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function downloadFirmware(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} downloading firmware`));
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseOTAHeader(buf) {
  if (buf.readUInt32LE(0) !== 0x0BEEF11E) throw new Error('Invalid OTA file tag');
  let offset = 10; // skip tag(4) + headerVersion(2) + headerLength(2) + fieldControl(2)
  const manufacturerCode = buf.readUInt16LE(offset); offset += 2;
  const imageType        = buf.readUInt16LE(offset); offset += 2;
  const fileVersion      = buf.readUInt32LE(offset); offset += 4;
  offset += 2;  // zigbeeStackVersion
  offset += 32; // headerString
  const totalImageSize   = buf.readUInt32LE(offset);
  return { manufacturerCode, imageType, fileVersion, totalImageSize };
}

function formatVersion(v) {
  // 0x1004 → 1.0.4 : upper nibble, second nibble, lower byte
  return `${(v >> 12) & 0xf}.${(v >> 8) & 0xf}.${v & 0xff}`;
}

function timeSince2000() {
  return Math.floor((Date.now() - new Date('2000-01-01T00:00:00Z').getTime()) / 1000) >>> 0;
}

class SonoffOTABoundCluster extends BoundCluster {

  constructor(endpoint, log, error, setStatus, formatStatus) {
    super();
    this.ep            = endpoint;
    this._log          = log          || ((...a) => console.log(...a));
    this._error        = error        || ((...a) => console.error(...a));
    this._setStatus    = setStatus    || (() => {});
    this._formatStatus = formatStatus || (({ state, pct, currentVersion, latestVersion }) => {
      switch (state) {
        case 'latest':    return `v${currentVersion} — up to date`;
        case 'available': return `New firmware available: v${latestVersion}`;
        case 'starting':  return 'Starting...';
        case 'updating':  return `Updating... ${pct}%`;
        case 'resuming':  return 'Resuming...';
        case 'complete':  return 'Complete!';
        default:          return state;
      }
    });
    this._active       = false;
    this._firmware     = null;
    this._meta         = null;
    this._manufacturerCode  = null;
    this._imageType         = null;
    this._deviceVersion     = null;
  }

  static get ID()         { return OTA_CLUSTER_ID; }
  static get NAME()       { return 'ota'; }
  static get ATTRIBUTES() { return {}; }

  // Call once on init with the device's manufacturerCode and imageType
  // so we can find the right entry in the index.
  async start(manufacturerCode, imageType) {
    this._manufacturerCode = manufacturerCode;
    this._imageType        = imageType;
    await this._checkForUpdate();
    this._startDailyCheck();
  }

  async _checkForUpdate() {
    try {
      this._log('OTA: fetching firmware index');
      const index = await fetchJSON(OTA_INDEX_URL);
      const entry = index.find(e =>
        e.manufacturerCode === this._manufacturerCode &&
        e.imageType        === this._imageType,
      );
      if (!entry) {
        this._log('OTA: no firmware found in index for this device');
        return;
      }
      this._log(`OTA: latest firmware v${formatVersion(entry.fileVersion)} available`);
      this._setStatus(this._formatStatus({
        state: 'available',
        latestVersion: formatVersion(entry.fileVersion),
        currentVersion: this._deviceVersion ? formatVersion(this._deviceVersion) : null,
      }));

      // If already cached and same version, reuse
      if (firmwareCache[entry.url]) {
        this._firmware = firmwareCache[entry.url].data;
        this._meta     = firmwareCache[entry.url].meta;
        this._log('OTA: firmware ready from cache');
      } else {
        this._log(`OTA: downloading firmware from ${entry.url}`);
        const buf  = await downloadFirmware(entry.url);
        const meta = parseOTAHeader(buf);
        firmwareCache[entry.url] = { data: buf, meta };
        this._firmware = buf;
        this._meta     = meta;
        this._log(`OTA: firmware loaded — mfr=0x${meta.manufacturerCode.toString(16)} imageType=0x${meta.imageType.toString(16)} version=0x${meta.fileVersion.toString(16)} size=${buf.length}`);
      }

      await this.announceAvailableUpdate();
    } catch (err) {
      this._error('OTA: update check failed:', err.message);
    }
  }

  _startDailyCheck() {
    if (this._dailyInterval) return;
    this._dailyInterval = setInterval(() => {
      if (!this._active) this._checkForUpdate();
    }, 24 * 60 * 60 * 1000); // every 24 hours
  }

  _startAnnounceInterval() {
    this._stopAnnounceInterval();
    // Re-announce every 5 minutes until device wakes up and starts the update
    this._announceInterval = setInterval(async () => {
      if (!this._active) await this.announceAvailableUpdate().catch(() => {});
    }, 5 * 60 * 1000);
  }

  _stopAnnounceInterval() {
    if (this._announceInterval) {
      clearInterval(this._announceInterval);
      this._announceInterval = null;
    }
  }

  destroy() {
    this._stopAnnounceInterval();
    if (this._dailyInterval) {
      clearInterval(this._dailyInterval);
      this._dailyInterval = null;
    }
  }

  async announceAvailableUpdate() {
    if (!this._meta) return;
    try {
      // Image Notify (cmdId 0x00):
      // payloadType(1) + queryJitter(1) + manufacturerCode(2) + imageType(2) + fileVersion(4) = 10 bytes
      const { manufacturerCode: fMfr, imageType: fType, fileVersion: fVer } = this._meta;
      const p = Buffer.alloc(10);
      p.writeUInt8(0x03, 0);      // payloadType: all fields present
      p.writeUInt8(100, 1);       // queryJitter: 100 = always respond
      p.writeUInt16LE(fMfr, 2);   // manufacturerCode
      p.writeUInt16LE(fType, 4);  // imageType
      p.writeUInt32LE(fVer, 6);   // fileVersion
      this._log('OTA: sending Image Notify');
      await this._send(0x01, 0x00, p);
      this._startAnnounceInterval();
    } catch (err) {
      this._error('OTA: Image Notify failed:', err.message);
    }
  }

  async handleFrame(frame, meta, rawFrame) {
    try {
      switch (frame.cmdId) {
        case 0x01: await this._onQueryNextImage(frame); break;
        case 0x03: await this._onImageBlockRequest(frame); break;
        case 0x06: await this._onUpgradeEnd(frame); break;
        default:
          this._log(`OTA: unhandled cmdId=0x${frame.cmdId.toString(16)}`);
      }
    } catch (err) {
      this._error('OTA: handleFrame error:', err.message);
    }
  }

  async _send(seqNum, cmdId, payload) {
    // ZCL frame: frameControl(1) + seqNum(1) + cmdId(1) + payload
    // frameControl = cluster-specific(01) | direction-to-client(08) | disable-default-response(10) = 0x19
    const buf = Buffer.alloc(3 + payload.length);
    buf.writeUInt8(0x19, 0);
    buf.writeUInt8(seqNum, 1);
    buf.writeUInt8(cmdId, 2);
    payload.copy(buf, 3);
    await this.ep._node.sendFrame(1, OTA_CLUSTER_ID, buf);
  }

  async _onQueryNextImage(frame) {
    const d = frame.data;
    let o = 0;
    const fieldControl    = d.readUInt8(o++);
    const manufacturerCode = d.readUInt16LE(o); o += 2;
    const imageType       = d.readUInt16LE(o); o += 2;
    const currentVersion  = d.readUInt32LE(o);

    this._log(`OTA: Query Next Image — mfr=0x${manufacturerCode.toString(16)} type=0x${imageType.toString(16)} currentVersion=0x${currentVersion.toString(16)}`);

    if (!this._firmware || !this._meta) {
      await this._send(frame.trxSequenceNumber, 0x02, Buffer.from([0x98])); // NO_IMAGE_AVAILABLE
      return;
    }

    const { manufacturerCode: fMfr, imageType: fType, fileVersion: fVer, totalImageSize } = this._meta;

    this._deviceVersion = currentVersion;

    if (manufacturerCode !== fMfr || imageType !== fType || fVer <= currentVersion) {
      this._log(`OTA: no upgrade needed (have=0x${fVer.toString(16)}, device=0x${currentVersion.toString(16)})`);
      this._setStatus(this._formatStatus({ state: 'latest', currentVersion: formatVersion(currentVersion) }));
      await this._send(frame.trxSequenceNumber, 0x02, Buffer.from([0x98]));
      return;
    }

    this._log(`OTA: offering v0x${fVer.toString(16)} (${totalImageSize} bytes)`);
    this._active = true;
    this._stopAnnounceInterval(); // device is awake and downloading — stop re-announcing
    this._setStatus(this._formatStatus({ state: 'starting', latestVersion: formatVersion(fVer) }));

    const p = Buffer.alloc(13);
    p.writeUInt8(0x00, 0); // SUCCESS
    p.writeUInt16LE(fMfr, 1);
    p.writeUInt16LE(fType, 3);
    p.writeUInt32LE(fVer, 5);
    p.writeUInt32LE(totalImageSize, 9);
    await this._send(frame.trxSequenceNumber, 0x02, p);
  }

  async _onImageBlockRequest(frame) {
    if (!this._firmware || !this._active) return;

    const d = frame.data;
    let o = 0;
    o++; // fieldControl
    o += 2; // manufacturerCode
    o += 2; // imageType
    o += 4; // fileVersion
    const fileOffset  = d.readUInt32LE(o); o += 4;
    const maxDataSize = d.readUInt8(o);

    const blockSize = Math.min(maxDataSize, this._firmware.length - fileOffset);
    if (blockSize <= 0) return;

    const { manufacturerCode: fMfr, imageType: fType, fileVersion: fVer } = this._meta;

    const block = this._firmware.slice(fileOffset, fileOffset + blockSize);
    const pct = Math.round((fileOffset / this._firmware.length) * 100);
    this._log(`OTA: block offset=${fileOffset} size=${blockSize} (${pct}%)`);
    this._setStatus(this._formatStatus({ state: 'updating', pct, latestVersion: formatVersion(fVer) }));

    const p = Buffer.alloc(14 + blockSize);
    p.writeUInt8(0x00, 0); // SUCCESS
    p.writeUInt16LE(fMfr, 1);
    p.writeUInt16LE(fType, 3);
    p.writeUInt32LE(fVer, 5);
    p.writeUInt32LE(fileOffset, 9);
    p.writeUInt8(blockSize, 13);
    block.copy(p, 14);

    await this._send(frame.trxSequenceNumber, 0x05, p);
  }

  async _onUpgradeEnd(frame) {
    const status = frame.data.readUInt8(0);
    this._log(`OTA: Upgrade End — status=0x${status.toString(16)}`);
    this._active = false;

    if (status !== 0x00) {
      this._log('OTA: device aborted, re-announcing to trigger resume');
      this._setStatus(this._formatStatus({ state: 'resuming', latestVersion: this._meta ? formatVersion(this._meta.fileVersion) : null }));
      await this.announceAvailableUpdate();
      return;
    }

    const { manufacturerCode: fMfr, imageType: fType, fileVersion: fVer } = this._meta;
    const now = timeSince2000();

    const p = Buffer.alloc(16);
    p.writeUInt16LE(fMfr, 0);
    p.writeUInt16LE(fType, 2);
    p.writeUInt32LE(fVer, 4);
    p.writeUInt32LE(now, 8);  // currentTime
    p.writeUInt32LE(0, 12);   // upgradeTime = now (upgrade immediately)

    await this._send(frame.trxSequenceNumber, 0x07, p);
    this._log('OTA: upgrade complete!');
    this._setStatus(this._formatStatus({ state: 'complete', latestVersion: formatVersion(fVer) }));
  }

}

try {
  Cluster.addCluster(SonoffOTABoundCluster);
} catch (err) {}

module.exports = SonoffOTABoundCluster;
