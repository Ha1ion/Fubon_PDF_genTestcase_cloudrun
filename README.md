# PDF 處理與測試案例生成 API

這是一個基於 Flask 的 Web 應用程式，旨在利用 Google Gemini 的強大功能處理 PDF 檔案，將其智能拆分為有意義的區塊，並生成結構化的測試案例，可實現彈性部署與擴展，並整合 Google Cloud Storage (GCS) 進行檔案的永久儲存。

## ✨ 功能特色

- **雲端原生架構**：使用 Google Cloud Run，為您提供高效能、可擴展的服務。
- **智慧文件分析**：透過 Gemini API 深度理解 PDF 內容，並提供最符合邏輯的拆分建議。
- **多元化拆分選項**：除了 AI 建議，您也可以依照頁碼範圍進行手動拆分，滿足各種情境需求。
- **自動化案例生成**：根據原始文件或拆分後的區塊，一鍵生成 CSV 格式的測試案例，大幅提升工作效率。
- **Google Cloud 整合**：與 Google Cloud Storage 無縫整合，確保您的檔案安全、可靠地儲存。

## 🚀 如何部署到 Google Cloud Run

依照以下步驟，您可以輕鬆將此應用程式部署到 Google Cloud Run。

**1. 前置需求**

- 一個已啟用 Cloud Run、Cloud Build 和 Artifact Registry API 的 Google Cloud 專案。
- 已安裝並完成身份驗證的 [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)。
- 一個用於儲存上傳檔案的 Google Cloud Storage (GCS) 儲存桶。

**2. 建立 GCS 儲存桶**

為您的專案建立一個 GCS 儲存桶。建議使用全域唯一的名稱。

```bash
export BUCKET_NAME="your-unique-bucket-name"
gcloud storage buckets create gs://${BUCKET_NAME} --location=asia-east1
```

**3. 部署到 Cloud Run**

在專案的根目錄下，執行以下指令。此指令將使用 Cloud Build 建置 Docker 映像檔，推送到 Artifact Registry，然後部署到 Cloud Run。

**重要**：請將 `your-gcs-bucket-name` 替換為您實際的儲存桶名稱，並將 `your-google-api-key` 替換為您的 Gemini API 金鑰。

```bash
gcloud run deploy your-service-name \
  --source . \
  --platform managed \
  --region asia-east1 \
  --allow-unauthenticated \
  --set-env-vars "GCS_BUCKET_NAME=your-gcs-bucket-name,GOOGLE_API_KEY=your-google-api-key"
```

部署完成後，指令將輸出您服務的公開 URL。

## 💻 如何在本機開發

想在本地端進行開發或測試？請遵循以下步驟。

**1. 建立虛擬環境**
```bash
python3 -m venv venv
source venv/bin/activate
```

**2. 安裝依賴套件**
```bash
pip install -r requirements.txt
```

**3. 建立 `.env` 檔案**

在專案根目錄建立 `.env` 檔案，並填入您的憑證。應用程式將會自動載入這些環境變數。

```
# .env 檔案

# 您的 Google API Key for Gemini
GOOGLE_API_KEY="your-google-api-key"

# 您用於本地測試的 GCS 儲存桶
GCS_BUCKET_NAME="your-gcs-bucket-name"
```

**4. 設定應用程式預設憑證 (ADC)**

為了讓應用程式在本地能順利通過 Google Cloud 服務的身份驗證，您需要設定 ADC。

```bash
gcloud auth application-default login
```

**5. 啟動 Flask 應用程式**
```bash
flask run
```

應用程式將在 `http://127.0.0.1:5000` 上啟動。

## 📂 專案結構

```
.
├── app.py                  # Flask 後端主程式
├── Dockerfile              # Docker 容器設定檔
├── requirements.txt        # Python 依賴套件
├── .env                    # 環境變數檔案 (本地開發用)
├── .gitignore              # Git 忽略清單
├── prompts/                # 存放給 AI 的指令 (Prompts)
│   ├── 1_split_suggester_prompt.txt
│   ├── 2_example_generator_prompt.txt
│   └── 3_final_generator_prompt.txt
├── static/                 # 存放前端靜態檔案
│   ├── script.js           # 前端 JavaScript 邏輯
│   └── fubon_logo.svg      # Logo
├── templates/              # 存放 Flask 網頁模板
│   └── index.html          # 主要操作介面
└── uploads/                # 存放使用者上傳及 AI 生成的檔案 (動態生成)
```