// app/index.js
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Button,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
} from "react-native";

import * as Notifications from "expo-notifications";
import * as SQLite from "expo-sqlite";
import * as Location from "expo-location";
import { Camera } from "expo-camera";

const isWeb = Platform.OS === "web";

// 通知處理：點擊通知時也會顯示
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function EmogoScreen() {
  const [db, setDb] = useState(null); // SQLiteDatabase (非 web)
  const [mood, setMood] = useState(3);
  const [location, setLocation] = useState(null);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState(false);
  const [videoUri, setVideoUri] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const cameraRef = useRef(null);

  // 初始化：SQLite、權限、通知
  useEffect(() => {
    (async () => {
      // 1. SQLite 只在非 web 平台初始化
      if (!isWeb) {
        try {
          const database = await SQLite.openDatabaseAsync("emogo.db");
          // 建表：logs(id, timestamp, mood, videoUri, lat, lng)
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
          setDb(database);
          console.log("SQLite initialized");
        } catch (e) {
          console.log("SQLite init error:", e);
        }
      } else {
        console.log("Running on web: skip SQLite (DB only on device).");
      }

      // 2. 位置權限（web 會跳過）
      if (!isWeb) {
        const loc = await Location.requestForegroundPermissionsAsync();
        setHasLocationPermission(loc.status === "granted");
      }

      // 3. 相機權限（web 會跳過）
      if (!isWeb) {
        const cam = await Camera.requestCameraPermissionsAsync();
        setHasCameraPermission(cam.status === "granted");
      }

      // 4. 通知權限與排程（只在非 web 真實裝置有用）
      if (!isWeb) {
        const noti = await Notifications.requestPermissionsAsync();
        if (noti.status === "granted") {
          await scheduleDailyNotifications();
        }
      }
    })();
  }, []);

  // 每天三次通知：9:00 / 15:00 / 21:00
  const scheduleDailyNotifications = async () => {
    await Notifications.cancelAllScheduledNotificationsAsync();
    const hours = [9, 15, 21];
    for (const hour of hours) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Emogo 記錄時間到了",
          body: "請打開 App 填寫心情、錄 1 秒 vlog，並收集 GPS。",
        },
        trigger: {
          hour,
          minute: 0,
          repeats: true,
        },
      });
    }
  };

  // 取得 GPS
  const getCurrentLocation = async () => {
    if (isWeb) {
      Alert.alert("提醒", "Web 預覽暫不取得真實 GPS，請在手機上測試。");
      return;
    }
    if (!hasLocationPermission) {
      Alert.alert("需要位置權限", "請到設定開啟位置權限");
      return;
    }
    const loc = await Location.getCurrentPositionAsync({});
    setLocation({
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
    });
    Alert.alert(
      "已取得 GPS",
      `${loc.coords.latitude}, ${loc.coords.longitude}`
    );
  };

  // 錄 1 秒 vlog
  const recordOneSecondVlog = async () => {
    if (isWeb) {
      Alert.alert("提醒", "Web 預覽不支援相機，請在手機上測試。");
      return;
    }
    if (!hasCameraPermission) {
      Alert.alert("需要相機權限", "請到設定開啟相機權限");
      return;
    }
    if (!cameraRef.current) {
      Alert.alert("相機尚未準備好");
      return;
    }

    try {
      setIsRecording(true);
      const video = await cameraRef.current.recordAsync({
        maxDuration: 1,
        quality: "480p",
      });
      setVideoUri(video.uri);
      Alert.alert("錄製完成", "已錄製 1 秒 vlog！");
    } catch (e) {
      console.log(e);
      Alert.alert("錄影失敗", "請再試一次");
    } finally {
      setIsRecording(false);
      if (cameraRef.current) {
        cameraRef.current.stopRecording();
      }
    }
  };

  // 儲存到 SQLite（非 web）
  const saveLog = async () => {
    if (!location) {
      Alert.alert("請先取得 GPS");
      return;
    }

    if (isWeb) {
      Alert.alert(
        "Web 版本不支援 SQLite",
        "請在手機上用 Expo Go 或模擬器測試資料庫功能。"
      );
      return;
    }

    if (!db) {
      Alert.alert("資料庫尚未準備好，請稍候再試。");
      return;
    }

    const timestamp = new Date().toISOString();

    try {
      await db.runAsync(
        "INSERT INTO logs (timestamp, mood, videoUri, lat, lng) VALUES (?, ?, ?, ?, ?)",
        timestamp,
        mood,
        videoUri || "",
        location.lat,
        location.lng
      );
      Alert.alert("已儲存", "這次的情緒、vlog 與 GPS 已存入 SQLite。");
    } catch (e) {
      console.log("Insert error:", e);
      Alert.alert("儲存失敗", "請查看 console log。");
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Emogo 日常記錄</Text>

      {isWeb && (
        <Text style={{ color: "red", marginBottom: 8 }}>
          （目前在 Web 預覽：SQLite / 相機 / GPS 皆以示意為主，請在手機上測試真實功能）
        </Text>
      )}

      {/* 1. 簡單情緒量表 */}
      <Text style={styles.subtitle}>1. 簡單情緒量表（1 = 很糟，5 = 很好）</Text>
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

      {/* 2. 1 秒 vlog */}
      <Text style={styles.subtitle}>2. 1 秒 vlog 錄影</Text>
      <View style={styles.cameraContainer}>
        {!isWeb && hasCameraPermission ? (
          <Camera ref={cameraRef} style={styles.camera} ratio="16:9" />
        ) : (
          <Text style={{ color: "#555" }}>
            {isWeb ? "Web 不支援相機預覽" : "尚未取得相機權限"}
          </Text>
        )}
      </View>
      <Button
        title={isRecording ? "錄影中..." : "錄製 1 秒 vlog"}
        onPress={recordOneSecondVlog}
        disabled={isRecording}
      />

      {/* 3. GPS */}
      <Text style={styles.subtitle}>3. 取得 GPS 座標</Text>
      <Button title="取得目前位置" onPress={getCurrentLocation} />
      {location && (
        <Text style={styles.locationText}>
          目前位置：{location.lat.toFixed(5)}, {location.lng.toFixed(5)}
        </Text>
      )}

      <View style={{ height: 16 }} />

      {/* 儲存到 SQLite */}
      <Button title="儲存這次紀錄到 SQLite" onPress={saveLog} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 16,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 8,
  },
  subtitle: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: "600",
  },
  moodRow: {
    flexDirection: "row",
    marginTop: 8,
    justifyContent: "space-between",
  },
  moodButton: {
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    alignItems: "center",
  },
  moodButtonSelected: {
    backgroundColor: "#8fd19e",
    borderColor: "#4caf50",
  },
  moodText: {
    fontSize: 16,
  },
  cameraContainer: {
    marginTop: 8,
    height: 200,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
  },
  camera: {
    flex: 1,
    alignSelf: "stretch",
  },
  locationText: {
    marginTop: 8,
  },
});
