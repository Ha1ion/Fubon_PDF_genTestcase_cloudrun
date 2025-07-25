import os
import uuid
import json
import fitz
from flask import Flask, request, jsonify, Response, render_template, send_from_directory
from werkzeug.utils import secure_filename
import google.generativeai as genai
from google.cloud import storage
from dotenv import load_dotenv
import io

# --- Initialization & Settings ---
app = Flask(__name__)

# Load environment variables
basedir = os.path.abspath(os.path.dirname(__file__))
load_dotenv(os.path.join(basedir, '.env'))

# GCS Configuration
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME")
if not GCS_BUCKET_NAME:
    raise ValueError("Error: GCS_BUCKET_NAME not found. Please set it in your .env file or environment variables.")
storage_client = storage.Client()
bucket = storage_client.bucket(GCS_BUCKET_NAME)

# Gemini API Configuration
API_KEY = os.getenv("GOOGLE_API_KEY")
if not API_KEY:
    raise ValueError("Error: GOOGLE_API_KEY not found. Please set it in your .env file or environment variables.")
genai.configure(api_key=API_KEY)

# --- Prompt Loading ---
def read_prompt(file_path):
    absolute_path = os.path.join(basedir, file_path)
    with open(absolute_path, 'r', encoding='utf-8') as f:
        return f.read()

PROMPT_SPLIT_SUGGESTER = read_prompt('prompts/1_split_suggester_prompt.txt')
PROMPT_EXAMPLE_GENERATOR = read_prompt('prompts/2_example_generator_prompt.txt')
PROMPT_FINAL_GENERATOR = read_prompt('prompts/3_final_generator_prompt.txt')

# --- Gemini Model Factory ---
def get_gemini_model(model_name='models/gemini-2.5-pro'):
    print(f"Initializing model: {model_name}")
    return genai.GenerativeModel(model_name)

# --- Helper function for page range parsing ---
def parse_page_range(pages_str, total_pages):
    try:
        pages_str = str(pages_str).strip()
        if '-' in pages_str:
            parts = pages_str.split('-')
            if len(parts) == 2:
                start_str, end_str = parts[0].strip(), parts[1].strip().lower()
                if start_str.isdigit():
                    start_page = int(start_str)
                    end_page = total_pages if end_str == 'end' else int(end_str)
                    return start_page, end_page
        elif pages_str.isdigit():
            page_num = int(pages_str)
            return page_num, page_num
    except (ValueError, TypeError):
        return None, None
    return None, None

# --- GCS Helper Functions ---
def gcs_upload_file(blob_name, file_stream):
    """Uploads a file stream to the GCS bucket."""
    blob = bucket.blob(blob_name)
    blob.upload_from_file(file_stream, content_type='application/pdf')
    print(f"Uploaded to GCS: {blob_name}")

def gcs_download_file(blob_name):
    """Downloads a file from GCS into a bytes buffer."""
    blob = bucket.blob(blob_name)
    return io.BytesIO(blob.download_as_bytes())

def gcs_get_public_url(blob_name):
    """Gets the public URL of a file in GCS."""
    return bucket.blob(blob_name).public_url

# --- Routes ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/static/<path:path>')
def send_static(path):
    return send_from_directory('static', path)

@app.route('/api/preview_pdf/<session_id>/<filename>')
def preview_pdf(session_id, filename):
    """Previews a PDF file from GCS."""
    blob_name = f"{session_id}/{filename}"
    try:
        file_bytes = gcs_download_file(blob_name)
        return Response(file_bytes, mimetype='application/pdf')
    except Exception as e:
        print(f"Error previewing file from GCS: {e}")
        return jsonify({"error": "File not found or access denied."}), 404

# === Main API Endpoints ===
# Step1
@app.route('/api/upload_pdf', methods=['POST'])
def upload_pdf():
    if 'pdf_file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['pdf_file']
    model_name = request.form.get('model_name', 'models/gemini-2.5-flash')
    try:
        session_id = str(uuid.uuid4())
        filename = secure_filename(file.filename)
        original_pdf_blob_name = f"{session_id}/{filename}"
        
        # Reset stream position and upload original file to GCS
        file.seek(0)
        gcs_upload_file(original_pdf_blob_name, file)
        
        # Process PDF from stream
        file.seek(0)
        doc = fitz.open(stream=file.read(), filetype="pdf")
        total_pages = len(doc)
        summary_text = "".join([doc[i].get_text() for i in range(min(total_pages, 10))])
        
        model = get_gemini_model(model_name)
        prompt = PROMPT_SPLIT_SUGGESTER.replace("{{pdf_summary_text}}", summary_text)
        response = model.generate_content(prompt)
        
        full_response_text = "".join([part.text for part in response.parts])
        clean_response = full_response_text.strip().replace("```json", "").replace("```", "").strip()
        suggested_splits = json.loads(clean_response)
        
        for i, split in enumerate(suggested_splits):
            tag = split.get('tag')
            pages_str = split.get('pages')
            start_page, end_page = parse_page_range(pages_str, total_pages)
            
            if not tag or start_page is None:
                print(f"[Warning] Skipping invalid split suggestion from AI: {split}")
                split['filename'] = None
                continue

            try:
                safe_tag = secure_filename(tag[:15]) or f"tag_{i}"
                split_filename = f"split_ai_{i}_{safe_tag}.pdf"
                split_blob_name = f"{session_id}/{split_filename}"
                split['filename'] = split_filename
                split['pages'] = f"{start_page}-{end_page}"
                
                new_doc = fitz.open()
                new_doc.insert_pdf(doc, from_page=start_page - 1, to_page=end_page - 1)
                
                # Upload split PDF to GCS
                pdf_bytes = new_doc.write()
                gcs_upload_file(split_blob_name, io.BytesIO(pdf_bytes))
                new_doc.close()
            except Exception as e:
                print(f"[Error] Failed to create split PDF for tag '{tag}': {e}")
                split['filename'] = None
        
        doc.close()
        return jsonify({"session_id": session_id, "filename": filename, "total_pages": total_pages, "suggested_splits": suggested_splits})
    except Exception as e:
        print(f"Error during PDF upload and analysis: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/create_manual_split', methods=['POST'])
def create_manual_split():
    data = request.json
    try:
        session_id = data['session_id']
        original_filename = data['original_filename']
        tag = data['tag']
        start_page = int(data['start_page'])
        end_page = int(data['end_page'])

        if not all([session_id, original_filename, tag, start_page, end_page]):
            return jsonify({"error": "Missing required parameters"}), 400
        
        original_pdf_blob_name = f"{session_id}/{original_filename}"
        
        safe_tag = secure_filename(tag[:15]) or "manual_split"
        manual_filename = f"split_manual_{safe_tag}_{start_page}-{end_page}.pdf"
        manual_blob_name = f"{session_id}/{manual_filename}"

        # Download original PDF from GCS
        original_pdf_stream = gcs_download_file(original_pdf_blob_name)
        doc = fitz.open(stream=original_pdf_stream, filetype="pdf")
        
        if start_page < 1 or end_page > len(doc):
            return jsonify({"error": f"Page range ({start_page}-{end_page}) is outside the document's total pages ({len(doc)})"}), 400

        new_doc = fitz.open()
        new_doc.insert_pdf(doc, from_page=start_page - 1, to_page=end_page - 1)
        
        # Upload manual split to GCS
        pdf_bytes = new_doc.write()
        gcs_upload_file(manual_blob_name, io.BytesIO(pdf_bytes))
        
        new_doc.close()
        doc.close()
        
        new_split_data = {
            "tag": tag,
            "pages": f"{start_page}-{end_page}",
            "filename": manual_filename
        }
        return jsonify({"new_split": new_split_data})
    except Exception as e:
        print(f"Error creating manual split: {e}")
        return jsonify({"error": str(e)}), 500

# Step2
@app.route('/api/generate_examples', methods=['POST'])
def generate_examples():
    data = request.json
    try:
        session_id, split = data['session_id'], data['split']
        model_name = data.get('model_name', 'models/gemini-2.5-pro')
        split_blob_name = f"{session_id}/{split['filename']}"
        
        # Download split PDF from GCS
        split_pdf_stream = gcs_download_file(split_blob_name)
        doc = fitz.open(stream=split_pdf_stream, filetype="pdf")
        chunk_text = "".join([page.get_text() for page in doc])
        doc.close()
        
        model = get_gemini_model(model_name)
        prompt = PROMPT_EXAMPLE_GENERATOR.replace("{{pdf_chunk_text}}", chunk_text)
        response = model.generate_content(prompt)
        
        examples_text = "".join([part.text for part in response.parts])
        return jsonify({"examples": examples_text.strip()})
    except Exception as e:
        print(f"Error during example generation: {e}")
        return jsonify({"error": str(e)}), 500

# Step3
@app.route('/api/generate_final_csv', methods=['POST'])
def generate_final_csv():
    data = request.json
    try:
        session_id, original_filename, examples = data['session_id'], data['filename'], data['examples']
        model_name = data.get('model_name', 'models/gemini-2.5-pro')
        source_info = data.get('source')
        
        source_blob_name = ""
        if source_info and source_info.get('type') == 'split':
            source_blob_name = f"{session_id}/{source_info['filename']}"
        else:
            source_blob_name = f"{session_id}/{original_filename}"
        
        print(f"Generating final CSV based on source: {source_blob_name}")
        
        # Download source PDF from GCS
        source_pdf_stream = gcs_download_file(source_blob_name)
        doc = fitz.open(stream=source_pdf_stream, filetype="pdf")
        full_pdf_text = "".join([page.get_text() for page in doc])
        doc.close()
        
        model = get_gemini_model(model_name)
        prompt = PROMPT_FINAL_GENERATOR.replace("{{high_quality_examples}}", examples)
        prompt = prompt.replace("{{full_pdf_text}}", full_pdf_text)
        
        response = model.generate_content(prompt)
        
        csv_content = "".join([part.text for part in response.parts]).strip()
        csv_with_bom = b'' + csv_content.encode('utf-8')
        return Response(csv_with_bom, mimetype="text/csv", headers={"Content-Disposition": f"attachment; filename=final_test_cases.csv"})
    except Exception as e:
        print(f"Error during final CSV generation: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=int(os.environ.get('PORT', 8080)))
