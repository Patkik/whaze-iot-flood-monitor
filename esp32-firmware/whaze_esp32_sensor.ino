/*
 * ============================================================================
 * WHAZE: IoT-Based Early Warning System for Enhanced Community Evacuation Preparedness
 * Institution : First City Providential College (FCPC), Brgy. Narra, Francisco Homes, CSJDM, Bulacan
 * Test Locale : Sunga Residence, Phase G3, Francisco Homes 1, Brgy. Yakal, CSJDM, Bulacan
 * Hardware    : ESP32 + JSN-SR04T / HC-SR04 Waterproof Ultrasonic Sensor + Float Switch
 *               + Piezo Buzzer + 3 LEDs (Green, Yellow, Red)
 * ============================================================================
 */

#include <WiFi.h>
#include <WebServer.h>

// ---- Pin Definitions (Matches Chapter 3 Instrumentation & Figure 6 Blueprint) ----
#define PIN_TRIG         5    // Ultrasonic Sensor Trigger Pin
#define PIN_ECHO         18   // Ultrasonic Sensor Echo Pin (via 1k/2k voltage divider)
#define PIN_FLOAT_SWITCH 19   // Backup Float Switch (INPUT_PULLUP, LOW = Triggered)
#define PIN_LED_GREEN    21   // Safe Status Indicator (< 15 cm water level)
#define PIN_LED_YELLOW   22   // Warning Status Indicator (15 - 29 cm water level)
#define PIN_LED_RED      23   // Critical Danger Indicator (>= 30 cm water level)
#define PIN_BUZZER       4    // Active Piezo Buzzer

// ---- Calibration & Threshold Constants ----
const float SENSOR_MOUNT_HEIGHT_CM = 100.0; // Distance from ultrasonic transducer to dry ground/channel bed
const float THRESHOLD_WARNING_CM   = 15.0;  // Yellow LED Warning threshold
const float THRESHOLD_CRITICAL_CM  = 30.0;  // Red LED + Piezo Buzzer Critical Evacuation threshold

// ---- Local Wi-Fi Credentials (SoftAP + Station Mode for Offline Local Area Access) ----
const char* AP_SSID = "Whaze-ESP32-FloodNode";
const char* AP_PASS = "fcpc2026";

WebServer server(80);

float currentDistanceCm = 88.0;
float currentWaterLevelCm = 12.0;
bool floatSwitchActive = false;
String currentStatus = "SAFE";
unsigned long lastSampleMs = 0;
unsigned long responseLatencyMs = 42;

float measureDistanceCm() {
  unsigned long tStart = millis();
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  long duration = pulseIn(PIN_ECHO, HIGH, 30000); // 30ms timeout
  responseLatencyMs = millis() - tStart + 35;     // Total sensing + processing latency (ms)

  if (duration <= 0) {
    return SENSOR_MOUNT_HEIGHT_CM;
  }
  float distance = (duration * 0.0343) / 2.0;
  return constrain(distance, 2.0, SENSOR_MOUNT_HEIGHT_CM);
}

void updateOutputs() {
  currentDistanceCm = measureDistanceCm();
  currentWaterLevelCm = max(0.0f, SENSOR_MOUNT_HEIGHT_CM - currentDistanceCm);
  floatSwitchActive = (digitalRead(PIN_FLOAT_SWITCH) == LOW);

  if (currentWaterLevelCm >= THRESHOLD_CRITICAL_CM || floatSwitchActive) {
    currentStatus = "CRITICAL";
    digitalWrite(PIN_LED_GREEN, LOW);
    digitalWrite(PIN_LED_YELLOW, LOW);
    digitalWrite(PIN_LED_RED, HIGH);
    digitalWrite(PIN_BUZZER, HIGH);
  } else if (currentWaterLevelCm >= THRESHOLD_WARNING_CM) {
    currentStatus = "WARNING";
    digitalWrite(PIN_LED_GREEN, LOW);
    digitalWrite(PIN_LED_YELLOW, HIGH);
    digitalWrite(PIN_LED_RED, LOW);
    digitalWrite(PIN_BUZZER, LOW);
  } else {
    currentStatus = "SAFE";
    digitalWrite(PIN_LED_GREEN, HIGH);
    digitalWrite(PIN_LED_YELLOW, LOW);
    digitalWrite(PIN_LED_RED, LOW);
    digitalWrite(PIN_BUZZER, LOW);
  }
}

void handleGetData() {
  // CORS headers for PWA fetch compatibility
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");

  String json = "{";
  json += "\"nodeId\":\"ESP32-FCPC-G3\",";
  json += "\"locale\":\"Phase G3, Francisco Homes 1, Brgy. Yakal, CSJDM\",";
  json += "\"waterLevelCm\":" + String(currentWaterLevelCm, 1) + ",";
  json += "\"sensorDistanceCm\":" + String(currentDistanceCm, 1) + ",";
  json += "\"mountHeightCm\":" + String(SENSOR_MOUNT_HEIGHT_CM, 1) + ",";
  json += "\"floatSwitch\":" + String(floatSwitchActive ? "true" : "false") + ",";
  json += "\"status\":\"" + currentStatus + "\",";
  json += "\"responseTimeMs\":" + String(responseLatencyMs) + ",";
  json += "\"uptimeSec\":" + String(millis() / 1000);
  json += "}";

  server.send(200, "application/json", json);
}

void handleOptions() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.send(204);
}

void setup() {
  Serial.begin(115200);

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  pinMode(PIN_FLOAT_SWITCH, INPUT_PULLUP);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_YELLOW, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);

  // Start offline-capable Wi-Fi Access Point for community residents
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.print("Whaze ESP32 AP IP: ");
  Serial.println(WiFi.softAPIP());

  server.on("/data", HTTP_GET, handleGetData);
  server.on("/data", HTTP_OPTIONS, handleOptions);
  server.begin();
}

void loop() {
  server.handleClient();
  if (millis() - lastSampleMs >= 1000) {
    lastSampleMs = millis();
    updateOutputs();
  }
}
