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
  Share,
} from "react-native";

import * as Notifications from "expo-notifications";
import * as SQLite from "expo-sqlite";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";

const isWeb = Platform.OS === "web";

const BACKEND_BASE_URL = "https://emogo-backend-csj011018.onrender.com";

// 通知處理：收到通知時顯示 alert（僅限原生）
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function EmogoScreen() {
  const [db, setDb] = useState(null); // 只在非 web 使用 SQLite
  const [mood, setMood] = useState(3);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState(false);
  const [videoUri, setVideoUri] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [logs, setLogs] = useState([]); // 顯示最近 5 筆紀錄（web / app 都用）

  // 初始化：SQLite、權限、通知
  useEffect(() => {
    (async () => {
      // 1. SQLite：只在非 web 建立 DB
      if (!isWeb) {
        try {
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
          const rows = await database.getAllAsync(
            "SELECT * FROM logs ORDER BY id DESC LIMIT 5;"
          );
          setDb(database);
          setLogs(rows);
        } catch (e) {
          console.log("SQLite init error:", e);
        }
      } else {
        console.log("Running on web: use in-memory logs only.");
      }

      // 2. 權限（只在原生環境請求）
      if (!isWeb) {
        const locPerm = await Location.requestForegroundPermissionsAsync();
        setHasLocationPermission(locPerm.status === "granted");

        const camPerm = await ImagePicker.requestCameraPermissionsAsync();
        setHasCameraPermission(camPerm.status === "granted");

        const notiPerm = await Notifications.requestPermissionsAsync();
        if (notiPerm.status === "granted") {
          await scheduleDailyNotifications();
        }
      }
    })();
  }, []);

  // 每日三次通知：9:00 / 15:00 / 21:00
  const scheduleDailyNotifications = async () => {
    await Notifications.cancelAllScheduledNotificationsAsync();
    const hours = [9, 15, 21];
    for (const hour of hours) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Emogo 記錄時間到了",
          body: "請打開 App 填寫心情、錄 1 秒 vlog，並收集 GPS。",
        },
        trigger: { hour, minute: 0, repeats: true },
      });
    }
  };

  // 🔍 在「儲存」當下默默取得 GPS（不顯示在畫面）
  const getLocationForSave = async () => {
    try {
      if (isWeb) {
        // Web 模式：給一個固定示意值，主要方便開發測試，不顯示在 UI
        return { lat: 25.033968, lng: 121.564468 };
      }

      let granted = hasLocationPermission;
      if (!granted) {
        const perm = await Location.requestForegroundPermissionsAsync();
        granted = perm.status === "granted";
        setHasLocationPermission(granted);
      }

      if (!granted) {
        Alert.alert("需要位置權限", "請到設定開啟位置權限才能儲存紀錄。");
        return null;
      }

      const loc = await Location.getCurrentPositionAsync({});
      return { lat: loc.coords.latitude, lng: loc.coords.longitude };
    } catch (e) {
      console.log("getLocationForSave error:", e);
      Alert.alert("取得 GPS 失敗", "請稍後再試。");
      return null;
    }
  };

  // 錄 1 秒 vlog
  const recordOneSecondVlog = async () => {
    if (isWeb) {
      Alert.alert("Web 模式", "瀏覽器無法錄製 vlog，請在手機上測試。");
      return;
    }

    const camPerm = await ImagePicker.requestCameraPermissionsAsync();
    if (camPerm.status !== "granted") {
      Alert.alert("需要相機權限", "若要錄製 vlog，請允許相機權限。");
      return;
    }
    setHasCameraPermission(true);

    try {
      setIsRecording(true);
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        videoMaxDuration: 1,
        allowsEditing: false,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const uri = result.assets[0].uri;
        setVideoUri(uri);
        Alert.alert("錄製完成", "已錄製 1 秒 vlog！");
      } else {
        console.log("User canceled camera");
      }
    } catch (e) {
      console.log("record error:", e);
      Alert.alert("錄影失敗", "請再試一次");
    } finally {
      setIsRecording(false);
    }
  };

  // 儲存紀錄到 SQLite + 自動上傳到後端（含影片檔）
  const saveLog = async () => {
    // 1. 要有 vlog
    if (!videoUri) {
      Alert.alert("請先錄製 vlog", "儲存前請先錄製 1 秒 vlog。");
      return;
    }

    // 2. 在這裡「默默」取得 GPS
    const loc = await getLocationForSave();
    if (!loc) {
      return; // 無法取得位置就不要繼續
    }

    const timestamp = new Date().toISOString();
    const newLog = {
      id: Date.now(), // web demo 用；原生會被 SQLite 的 id 覆蓋
      timestamp,
      mood,
      videoUri: videoUri || "",
      lat: loc.lat,
      lng: loc.lng,
    };

    // 更新畫面上的 logs
    setLogs((prev) => [newLog, ...prev].slice(0, 5));

    // 3. 寫入 SQLite（只在 App 上）
    if (!isWeb && db) {
      try {
        await db.runAsync(
          "INSERT INTO logs (timestamp, mood, videoUri, lat, lng) VALUES (?, ?, ?, ?, ?)",
          timestamp,
          mood,
          videoUri || "",
          loc.lat,
          loc.lng
        );
      } catch (e) {
        console.log("Insert error:", e);
      }
    }

    // 4. 上傳 metadata 到後端（JSON，寫進 MongoDB）
    try {
      await fetch(`${BACKEND_BASE_URL}/api/logs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timestamp,
          mood,
          videoUri: videoUri || "", // 若後端只拿來對應，可保留
          lat: loc.lat,
          lng: loc.lng,
        }),
      });
    } catch (e) {
      console.log("Upload metadata error:", e);
      Alert.alert("上傳資料失敗", "無法上傳情緒 / GPS 資料到後端。");
      return;
    }

    // 5. 上傳「影片本體」到後端（multipart/form-data）
    try {
      const formData = new FormData();
      formData.append("timestamp", timestamp);
      formData.append("mood", String(mood));
      formData.append("lat", String(loc.lat));
      formData.append("lng", String(loc.lng));
      formData.append("video", {
        uri: videoUri,
        name: `emogo_vlog_${Date.now()}.mp4`,
        type: "video/mp4",
      });

      await fetch(`${BACKEND_BASE_URL}/api/upload-video`, {
        method: "POST",
        body: formData,
        // 不要自己設 Content-Type，讓 fetch 自動帶 boundary
      });
    } catch (e) {
      console.log("Upload video error:", e);
      Alert.alert("上傳影片失敗", "情緒與 GPS 已上傳，但影片上傳失敗。");
      return;
    }

    Alert.alert("已儲存並上傳", "這次的心情、GPS 與 vlog 影片已上傳到後端。");
  };

  // 分享單一 vlog（選用）
  const shareVideo = async (uri) => {
    try {
      if (!uri) {
        Alert.alert("此紀錄沒有影片");
        return;
      }

      await Share.share({
        url: uri,
        message: "Emogo 影片紀錄",
        title: "Emogo VLOG",
      });
    } catch (e) {
      Alert.alert("影片分享失敗", e?.message ?? "未知錯誤");
    }
  };

  // 清除所有紀錄
  const clearLogs = async () => {
    if (!isWeb && db) {
      try {
        await db.runAsync("DELETE FROM logs");
      } catch (e) {
        console.log("clear error:", e);
        Alert.alert("清除失敗", "請查看 console log。");
        return;
      }
    }

    setLogs([]);
    setVideoUri(null);
    Alert.alert("已清除", "所有紀錄已清除。");
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Emogo 日常記錄</Text>

      {isWeb && (
        <Text style={{ color: "red", marginBottom: 8 }}>
          （目前在 Web 預覽：SQLite / 相機 / GPS 皆以示意為主）
        </Text>
      )}

      {/* 1. 心情量表 */}
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
      <Text style={{ marginTop: 4 }}>目前選擇心情：{mood}</Text>

      {/* 2. 1 秒 vlog */}
      <Text style={styles.subtitle}>2. 1 秒 vlog 錄影</Text>
      <View style={styles.cameraContainer}>
        <Text style={{ color: "#ccc", textAlign: "center", paddingHorizontal: 8 }}>
          按下下方按鈕會開啟系統相機錄製 1 秒 vlog。
        </Text>
      </View>
      <View style={{ marginTop: 8 }}>
        <Button
          title={isRecording ? "錄影中..." : "錄製 1 秒 VLOG"}
          onPress={recordOneSecondVlog}
          disabled={isRecording}
        />
      </View>
      {videoUri && (
        <Text style={{ marginTop: 4, fontSize: 12 }} numberOfLines={1}>
          目前 vlog URI：{videoUri}
        </Text>
      )}

      {/* 3. GPS：不再有按鈕 & 不顯示座標，改成在儲存時默默取得 */}

      <View style={{ height: 16 }} />
      <Button title="儲存這次紀錄" onPress={saveLog} />

      {/* 只保留「清除所有紀錄」，移除 JSON 匯出按鈕 */}
      <View style={{ marginTop: 16 }}>
        <Button color="#cc3333" title="清除所有紀錄" onPress={clearLogs} />
      </View>

      {/* 最近 5 筆紀錄（不顯示 GPS 座標） */}
      <Text style={[styles.subtitle, { marginTop: 24 }]}>
        最近 5 筆紀錄（Web：示意；App：來自 SQLite）
      </Text>
      {logs.length === 0 ? (
        <Text style={{ marginTop: 4 }}>目前尚無任何紀錄。</Text>
      ) : (
        logs.map((log) => (
          <View key={log.id} style={styles.logItem}>
            <Text style={styles.logLine}>
              時間：{new Date(log.timestamp).toLocaleString()}
            </Text>
            <Text style={styles.logLine}>心情：{log.mood}</Text>
            <Text style={styles.logLine} numberOfLines={1}>
              vlog：{log.videoUri || "(無)"}
            </Text>
            {log.videoUri ? (
              <View style={{ marginTop: 4 }}>
                <Button
                  title="分享這段影片"
                  onPress={() => shareVideo(log.videoUri)}
                />
              </View>
            ) : null}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: "#fff",
  },
  container: {
    paddingTop: 40,
    paddingHorizontal: 16,
    paddingBottom: 40,
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
    height: 120,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
  },
  logItem: {
    marginTop: 8,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  logLine: {
    fontSize: 12,
  },
});
