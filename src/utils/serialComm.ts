/**
 * Utility for Serial Communication with Arduino.
 * Uses Web Serial API.
 */

let port: SerialPort | null = null;
let writer: WritableStreamDefaultWriter<any> | null = null;
let reader: ReadableStreamDefaultReader<any> | null = null;
let keepReading = true;

export function isConnected() {
  return port !== null && port.readable !== null && writer !== null;
}

export async function initSerial(auto = false) {
  if (!('serial' in navigator)) {
    console.warn("Web Serial API not supported in this browser.");
    return { success: false, error: 'Not supported' };
  }

  // Safety: If there is an existing port, try to close it first
  if (port) {
    try {
      await closeSerial();
    } catch (e) {
      console.warn("Cleanup of old port failed:", e);
    }
  }

  try {
    if (auto) {
      const ports = await navigator.serial.getPorts();
      if (ports.length > 0) {
        port = ports[0];
      } else {
        return { success: false, error: 'No authorized ports found' };
      }
    } else {
      port = await navigator.serial.requestPort();
    }

    await port.open({ baudRate: 9600 });
    
    keepReading = true;
    writer = port.writable!.getWriter();
    startReading(); // Start async read loop
    
    // Proactively ping every second until we get a response (up to 5 times)
    let pings = 0;
    const pingInterval = setInterval(() => {
      if (pings >= 5 || port === null) {
        clearInterval(pingInterval);
      } else {
        sendCommand("PING");
        pings++;
      }
    }, 1000);
    
    console.log(`Serial Connected Successfully @ 9600 (Auto: ${auto})`);
    return { success: true };
  } catch (err) {
    console.error("Failed to init serial:", err);
    return { success: false, error: err };
  }
}

let listeners = new Set<(msg: string) => void>();

export function onMessage(callback: (msg: string) => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

async function startReading() {
  if (!port || !port.readable) return;
  
  reader = port.readable.getReader();
  const decoder = new TextDecoder();

  try {
    let buffer = '';
    while (keepReading) {
      const { value, done } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes('\n')) {
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            console.log(`SERIAL RECV: ${trimmed}`);
            listeners.forEach(cb => cb(trimmed));
          }
        }
      }
    }
  } catch (err) {
    console.error("Serial Read Error:", err);
  } finally {
    reader.releaseLock();
  }
}

export async function sendCommand(command: string) {
  if (!writer) {
    console.error("Serial not connected");
    return;
  }
  
  const fullCommand = command.endsWith('\n') ? command : `${command}\n`;
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(fullCommand));
  console.log(`SERIAL SEND: ${fullCommand.trim()}`);
}

export async function closeSerial() {
  keepReading = false;
  if (reader) {
    await reader.cancel();
    reader = null;
  }
  if (writer) {
    writer.releaseLock();
    writer = null;
  }
  if (port) {
    await port.close();
    port = null;
  }
  console.log("Serial Closed");
}
