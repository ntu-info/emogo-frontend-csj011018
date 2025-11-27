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
  Share,
} from "react-native";

import * as Notifications from "expo-notifications";
import * as SQLite from "expo-sqlite";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
// import * as FileSystem from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";


const isWeb = Platform.OS === "web";

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
  const [location, setLocation] = useState(null);
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

  // 取得 GPS
  const getCurrentLocation = async () => {
    if (isWeb) {
      // Web：示意用台北 101 座標
      const fakeLoc = { lat: 25.033968, lng: 121.564468 };
      setLocation(fakeLoc);
      Alert.alert(
        "Web 模式",
        `使用示意 GPS：${fakeLoc.lat.toFixed(5)}, ${fakeLoc.lng.toFixed(5)}`
      );
      return;
    }

    if (!hasLocationPermission) {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert("需要位置權限", "請到設定開啟位置權限");
        return;
      }
      setHasLocationPermission(true);
    }

    const loc = await Location.getCurrentPositionAsync({});
    const pos = { lat: loc.coords.latitude, lng: loc.coords.longitude };
    setLocation(pos);
    Alert.alert(
      "已取得 GPS",
      `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`
    );
  };

  // 錄 1 秒 vlog（使用系統相機，真的錄影）
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
        videoMaxDuration: 1, // 1 秒 vlog
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

  // 儲存紀錄到 SQLite
  const saveLog = async () => {
    if (!location) {
      Alert.alert("請先取得 GPS");
      return;
    }

    const timestamp = new Date().toISOString();
    const newLog = {
      id: Date.now(), // web demo 用隨機 id；原生會被 SQLite 的 id 覆蓋
      timestamp,
      mood,
      videoUri: videoUri || "",
      lat: location.lat,
      lng: location.lng,
    };

    // 先更新畫面上的 logs（web / app 都有）
    setLogs((prev) => [newLog, ...prev].slice(0, 5));

    // 真正寫入 SQLite（只在 app 上）
    if (!isWeb && db) {
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
    } else if (isWeb) {
      Alert.alert(
        "Web 模式",
        "已把這次紀錄加入畫面下方的清單（實際 SQLite 儲存只在手機 App 上）。"
      );
    }
  };

  // 一鍵匯出：把所有紀錄打包成 JSON 檔案並分享
  const exportLogsAsJson = async () => {
    try {
      let allLogs = [];

      // 1. 從 SQLite 或記憶體取出所有紀錄
      if (!isWeb && db) {
        allLogs = await db.getAllAsync(
          "SELECT * FROM logs ORDER BY id ASC;"
        );
      } else {
        allLogs = logs.slice().reverse(); // web 示意
      }

      if (!allLogs || allLogs.length === 0) {
        Alert.alert("目前沒有任何紀錄可匯出。");
        return;
      }

      // 2. 建立 JSON payload
      const payload = {
        exportedAt: new Date().toISOString(),
        device: Platform.OS,
        count: allLogs.length,
        records: allLogs.map((row) => ({
          timestamp: row.timestamp,
          mood: row.mood,
          videoUri: row.videoUri || "",
          lat: row.lat,
          lng: row.lng,
        })),
      };

      const jsonString = JSON.stringify(payload, null, 2);

      // 3. Web 或無法寫檔：印到 console
      if (isWeb || !FileSystem.documentDirectory) {
        console.log(jsonString);
        Alert.alert(
          "Web / 不支援檔案模式",
          "已在 console 印出 JSON 內容，請從開發者工具複製。"
        );
        return;
      }

      // 4. 原生：寫成 .json 檔並分享
      const fileUri =
        FileSystem.documentDirectory +
        `emogo_logs_${Date.now()}.json`;

      await FileSystem.writeAsStringAsync(fileUri, jsonString, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      await Share.share({
        url: fileUri,
        message: `Emogo JSON 匯出，共 ${allLogs.length} 筆紀錄`,
        title: "Emogo 日誌 JSON 匯出",
      });
    } catch (e) {
      console.log("export json error:", e);
      Alert.alert(
        "匯出失敗",
        `產生 JSON 發生錯誤：${e?.message ?? JSON.stringify(e)}`
      );
    }
  };

  // 分享單一影片（備用：如果老師只想看某支）
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
    setLocation(null);
    Alert.alert("已清除", "所有紀錄已清除。");
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Emogo 日常記錄</Text>

      {isWeb && (
        <Text style={{ color: "red", marginBottom: 8 }}>
          （目前在 Web 預覽：SQLite / 相機 / GPS 皆以示意為主，JSON 匯出僅支援手機 App）
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

      {/* 3. GPS */}
      <Text style={styles.subtitle}>3. 取得 GPS 座標</Text>
      <Button title="取得目前位置" onPress={getCurrentLocation} />
      {location && (
        <Text style={styles.locationText}>
          目前位置：{location.lat.toFixed(5)}, {location.lng.toFixed(5)}
        </Text>
      )}

      <View style={{ height: 16 }} />
      <Button title="儲存這次紀錄到 SQLITE" onPress={saveLog} />

      {/* 匯出 / 清除 按鈕 */}
      <View style={{ marginTop: 16, flexDirection: "row" }}>
        <View style={{ flex: 1, marginRight: 4 }}>
          <Button
            title="匯出所有紀錄（JSON）"
            onPress={exportLogsAsJson}
          />
        </View>
        <View style={{ flex: 1, marginLeft: 4 }}>
          <Button color="#cc3333" title="清除所有紀錄" onPress={clearLogs} />
        </View>
      </View>

      {/* 4. 最近紀錄列表 */}
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
            <Text style={styles.logLine}>
              GPS：{log.lat.toFixed(5)}, {log.lng.toFixed(5)}
            </Text>
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
  locationText: {
    marginTop: 8,
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
