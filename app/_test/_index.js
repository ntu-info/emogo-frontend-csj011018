// app/index.js
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Button,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  ScrollView,
  Linking,
} from "react-native";

import * as Notifications from "expo-notifications";
import * as SQLite from "expo-sqlite";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";

const isWeb = Platform.OS === "web";

// 🟦 Base64（React Native 內建 btoa，可直接用）
const toBase64 = (text) => global.btoa(unescape(encodeURIComponent(text)));

// 🟦 打開 JSON 頁面
const openJsonInBrowser = async (jsonString) => {
  try {
    const escaped = jsonString
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const html = `
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>Emogo Export</title>
        </head>
        <body>
          <h2>Emogo 匯出紀錄</h2>
          <pre>${escaped}</pre>
        </body>
      </html>
    `;

    const base64 = toBase64(html);
    const url = `data:text/html;base64,${base64}`;

    await Linking.openURL(url);
  } catch (err) {
    Alert.alert("匯出失敗", err.message);
  }
};

// =======================================================================
// 主畫面
// =======================================================================
export default function EmogoScreen() {
  const [db, setDb] = useState(null);
  const [mood, setMood] = useState(3);
  const [location, setLocation] = useState(null);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [videoUri, setVideoUri] = useState(null);
  const [logs, setLogs] = useState([]);

  // 初始化
  useEffect(() => {
    (async () => {
      if (!isWeb) {
        const database = await SQLite.openDatabaseAsync("emogo.db");

        await database.execAsync(`
          CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            mood INTEGER,
            videoUri TEXT,
            lat REAL,
            lng REAL
          );
        `);

        const rows = await database.getAllAsync(`
          SELECT * FROM logs ORDER BY id DESC LIMIT 5;
        `);

        setDb(database);
        setLogs(rows);
      }

      // 權限
      const loc = await Location.requestForegroundPermissionsAsync();
      setHasLocationPermission(loc.status === "granted");

      const noti = await Notifications.requestPermissionsAsync();
      if (noti.status === "granted") scheduleDailyNotifications();
    })();
  }, []);

  // 通知
  const scheduleDailyNotifications = async () => {
    await Notifications.cancelAllScheduledNotificationsAsync();
    const hours = [9, 15, 21];

    for (const hour of hours) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Emogo 記錄提醒",
          body: "請打開 App 填寫心情、錄製 vlog、取得 GPS。",
        },
        trigger: { hour, minute: 0, repeats: true },
      });
    }
  };

  // 取得 GPS
  const getCurrentLocation = async () => {
    if (!hasLocationPermission) {
      Alert.alert("錯誤", "請允許 GPS 權限");
      return;
    }

    const loc = await Location.getCurrentPositionAsync({});
    const pos = { lat: loc.coords.latitude, lng: loc.coords.longitude };
    setLocation(pos);

    Alert.alert("已取得位置", `${pos.lat}, ${pos.lng}`);
  };

  // 錄 1 秒 vlog
  const recordOneSecondVlog = async () => {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (cam.status !== "granted") {
      Alert.alert("請啟用相機權限");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: 1,
    });

    if (!result.canceled && result.assets.length > 0) {
      setVideoUri(result.assets[0].uri);
      Alert.alert("錄影完成");
    }
  };

  // 儲存紀錄
  const saveLog = async () => {
    if (!location) {
      Alert.alert("請先取得 GPS");
      return;
    }

    const timestamp = new Date().toISOString();
    const newLog = {
      id: Date.now(),
      timestamp,
      mood,
      videoUri: videoUri || "",
      lat: location.lat,
      lng: location.lng,
    };

    setLogs((prev) => [newLog, ...prev].slice(0, 5));

    if (db) {
      await db.runAsync(
        "INSERT INTO logs (timestamp, mood, videoUri, lat, lng) VALUES (?, ?, ?, ?, ?)",
        timestamp,
        mood,
        videoUri || "",
        location.lat,
        location.lng
      );

      Alert.alert("已儲存");
    }
  };

  // 匯出 → 開網頁顯示 JSON
  const exportLogsAsJson = async () => {
    let allLogs = [];

    if (db) {
      allLogs = await db.getAllAsync("SELECT * FROM logs ORDER BY id ASC;");
    } else {
      allLogs = logs.slice().reverse();
    }

    if (allLogs.length === 0) {
      Alert.alert("目前沒有紀錄可匯出");
      return;
    }

    const jsonStr = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        device: Platform.OS,
        count: allLogs.length,
        records: allLogs,
      },
      null,
      2
    );

    openJsonInBrowser(jsonStr);
  };

  // 清除紀錄
  const clearLogs = async () => {
    if (db) {
      await db.runAsync("DELETE FROM logs");
    }
    setLogs([]);
    setLocation(null);
    setVideoUri(null);

    Alert.alert("已清除所有紀錄");
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Emogo 日常記錄</Text>

      {/* 心情 */}
      <Text style={styles.subtitle}>1. 心情量表</Text>
      <View style={styles.moodRow}>
        {[1, 2, 3, 4, 5].map((value) => (
          <TouchableOpacity
            key={value}
            style={[
              styles.moodButton,
              mood === value && styles.moodButtonSelected,
            ]}
            onPress={() => setMood(value)}
          >
            <Text style={styles.moodText}>{value}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Vlog */}
      <Text style={styles.subtitle}>2. 錄製 1 秒 vlog</Text>
      <Button title="錄影" onPress={recordOneSecondVlog} />
      {videoUri && <Text>影片：{videoUri}</Text>}

      {/* GPS */}
      <Text style={styles.subtitle}>3. GPS</Text>
      <Button title="取得 GPS" onPress={getCurrentLocation} />
      {location && (
        <Text>
          GPS：{location.lat.toFixed(5)}, {location.lng.toFixed(5)}
        </Text>
      )}

      <Button title="儲存紀錄" onPress={saveLog} />

      <View style={{ marginTop: 16 }}>
        <Button title="匯出所有紀錄（JSON）" onPress={exportLogsAsJson} />
        <View style={{ height: 8 }} />
        <Button title="清除所有紀錄" color="#cc3333" onPress={clearLogs} />
      </View>

      <Text style={[styles.subtitle, { marginTop: 24 }]}>
        最近紀錄（{logs.length} 筆）
      </Text>

      {logs.map((log) => (
        <View key={log.id} style={styles.logItem}>
          <Text>時間：{new Date(log.timestamp).toLocaleString()}</Text>
          <Text>心情：{log.mood}</Text>
          <Text>GPS：{log.lat}, {log.lng}</Text>
          <Text numberOfLines={1}>影片：{log.videoUri}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: { padding: 20 },
  title: { fontSize: 24, fontWeight: "bold" },
  subtitle: { marginTop: 20, fontWeight: "bold", fontSize: 16 },
  moodRow: { flexDirection: "row", marginTop: 10 },
  moodButton: {
    flex: 1,
    margin: 5,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  moodButtonSelected: {
    backgroundColor: "#a2e2b8",
    borderColor: "#4caf50",
  },
  moodText: { fontSize: 16 },
  logItem: {
    marginTop: 10,
    padding: 10,
    borderWidth: 1,
    borderRadius: 10,
  },
});
