document.addEventListener('DOMContentLoaded', () => {
    // --- Global State ---
    let session_id = null;
    let original_filename = null;
    let confirmed_splits = [];
    let sortable_instance = null;
    let currentAbortController = null;

    // --- Element References ---
    const col2 = document.getElementById('col-2-gen-example');
    const col3 = document.getElementById('col-3-gen-final');
    const uploadBtn = document.getElementById('upload-btn');
    const pdfFileInput = document.getElementById('pdf-file-input');
    const splitLoader = document.getElementById('split-loader');
    const splitResultsSection = document.getElementById('split-results-section');
    const splitList = document.getElementById('split-list');
    const splitItemTemplate = document.getElementById('split-item-template');
    const confirmSplitBtn = document.getElementById('confirm-split-btn');
    const addManualSplitBtn = document.getElementById('add-manual-split-btn');
    const manualTagInput = document.getElementById('manual-tag-input');
    const manualStartPage = document.getElementById('manual-start-page');
    const manualEndPage = document.getElementById('manual-end-page');
    const manualSplitLoader = document.getElementById('manual-split-loader');
    const addManualSplitText = document.getElementById('add-manual-split-text');
    const splitSelect = document.getElementById('split-select');
    const generateExampleBtn = document.getElementById('generate-example-btn');
    const exampleLoader = document.getElementById('example-loader');
    const exampleTextarea = document.getElementById('example-textarea');
    const confirmExampleBtn = document.getElementById('confirm-example-btn');
    const finalSourceSelect = document.getElementById('final-source-select');
    const finalExamplePreview = document.getElementById('final-example-preview');
    const generateFinalBtn = document.getElementById('generate-final-btn');
    const finalLoader = document.getElementById('final-loader');
    const messageArea = document.getElementById('message-area');
    const cancelBtn1 = document.getElementById('cancel-btn-1');
    const cancelBtn2 = document.getElementById('cancel-btn-2');
    const cancelBtn3 = document.getElementById('cancel-btn-3');

    // --- Helper Functions ---
    const getSelectedModel = (stage) => {
        const select = document.getElementById(`model-select-${stage}`);
        const customInput = document.getElementById(`custom-model-${stage}`);
        if (select.value === 'custom') {
            const customValue = customInput.value.trim();
            if (customValue) return customValue;
            return select.options[0].value;
        }
        return select.value;
    };

    document.querySelectorAll('.model-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const stage = e.target.dataset.stage;
            const customInput = document.getElementById(`custom-model-${stage}`);
            customInput.classList.toggle('hidden', e.target.value !== 'custom');
        });
    });

    const showMessage = (text, type = 'info') => {
        messageArea.textContent = text;
        const baseClasses = 'mt-6 p-4 rounded-lg text-center';
        let typeClasses = 'bg-blue-100 text-blue-700'; // info
        if (type === 'error') typeClasses = 'bg-red-100 text-red-700';
        if (type === 'success') typeClasses = 'bg-green-100 text-green-700';
        messageArea.className = `${baseClasses} ${typeClasses}`;
    };

    const toggleButtonLoader = (btn, textElement, loaderElement, isLoading) => {
        btn.disabled = isLoading;
        textElement.classList.toggle('hidden', isLoading);
        loaderElement.classList.toggle('hidden', !isLoading);
    };

    const initSortable = () => {
        if (sortable_instance) sortable_instance.destroy();
        sortable_instance = new Sortable(splitList, {
            handle: '.drag-handle',
            animation: 150,
            ghostClass: 'sortable-ghost'
        });
    };

    const cancelCurrentRequest = () => {
        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
        }
    };
    cancelBtn1.addEventListener('click', cancelCurrentRequest);
    cancelBtn2.addEventListener('click', cancelCurrentRequest);
    cancelBtn3.addEventListener('click', cancelCurrentRequest);

    // --- STAGE 1 LOGIC ---
    uploadBtn.addEventListener('click', async () => {
        if (!pdfFileInput.files.length) { showMessage('請先選擇一個 PDF 檔案。', 'error'); return; }
        
        currentAbortController = new AbortController();
        const formData = new FormData();
        formData.append('pdf_file', pdfFileInput.files[0]);
        formData.append('model_name', getSelectedModel(1));

        splitLoader.classList.remove('hidden');
        uploadBtn.disabled = true;
        messageArea.classList.add('hidden');

        try {
            const response = await fetch('/api/upload_pdf', { method: 'POST', body: formData, signal: currentAbortController.signal });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || '未知的伺服器錯誤');
            
            session_id = data.session_id;
            original_filename = data.filename;

            splitList.innerHTML = '';
            data.suggested_splits.forEach(split => addSplitItem(split));
            splitResultsSection.classList.remove('hidden');
            confirmSplitBtn.classList.remove('hidden');
            initSortable();

        } catch (error) {
            if (error.name === 'AbortError') {
                showMessage('PDF 分析已取消。', 'info');
            } else {
                showMessage(`分析失敗: ${error.message}`, 'error');
            }
        } finally {
            splitLoader.classList.add('hidden');
            uploadBtn.disabled = false;
            currentAbortController = null;
        }
    });

    const addSplitItem = (split) => {
        const itemTemplate = document.getElementById('split-item-template');
        const item = itemTemplate.content.cloneNode(true);
        item.querySelector('.tag-name-input').value = split.tag;
        if (split.pages) {
            const [start, end] = split.pages.split('-').map(p => parseInt(p, 10));
            item.querySelector('.page-start-input').value = start;
            item.querySelector('.page-end-input').value = end;
        }
        const previewBtn = item.querySelector('.preview-btn');
        if (session_id && split.filename) {
            previewBtn.href = `/api/preview_pdf/${session_id}/${split.filename}`;
        } else {
            previewBtn.classList.add('hidden');
        }
        splitList.appendChild(item);
    };

    const handleUpdateSplit = async (itemElement) => {
        const tag = itemElement.querySelector('.tag-name-input').value.trim();
        const start = itemElement.querySelector('.page-start-input').value;
        const end = itemElement.querySelector('.page-end-input').value;
        const loader = itemElement.querySelector('.item-loader');
        const updateBtn = itemElement.querySelector('.update-split-btn');

        if (!tag || !start || !end) { showMessage("標籤和起訖頁碼不能為空。", "error"); return; }

        loader.classList.remove('hidden');
        updateBtn.disabled = true;

        try {
            const response = await fetch('/api/create_manual_split', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id, original_filename, tag, start_page: start, end_page: end })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || '更新失敗');
            
            const previewBtn = itemElement.querySelector('.preview-btn');
            previewBtn.href = `/api/preview_pdf/${session_id}/${data.new_split.filename}`;
            previewBtn.classList.remove('hidden');
            showMessage(`區塊 "${tag}" 已更新。`, 'success');
        } catch(error) {
            showMessage(`更新失敗: ${error.message}`, 'error');
        } finally {
            loader.classList.add('hidden');
            updateBtn.disabled = false;
        }
    };

    splitList.addEventListener('click', (e) => {
        const target = e.target;
        if (target.closest('.remove-split-btn')) {
            target.closest('.split-item').remove();
        }
        if (target.closest('.update-split-btn')) {
            handleUpdateSplit(target.closest('.split-item'));
        }
    });
    
    addManualSplitBtn.addEventListener('click', async () => {
        const tag = manualTagInput.value.trim();
        const start = manualStartPage.value;
        const end = manualEndPage.value;

        if (!tag || !start || !end) { showMessage("手動切割的標籤和起訖頁碼不能為空。", "error"); return; }
        if (parseInt(start) > parseInt(end)) { showMessage("起始頁碼不能大於結束頁碼。", "error"); return; }

        toggleButtonLoader(addManualSplitBtn, addManualSplitText, manualSplitLoader, true);

        try {
            const response = await fetch('/api/create_manual_split', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id, original_filename, tag, start_page: start, end_page: end })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || '手動切割失敗');

            addSplitItem(data.new_split);
            manualTagInput.value = '';
            manualStartPage.value = '';
            manualEndPage.value = '';
        } catch (error) {
            showMessage(`新增失敗: ${error.message}`);
        } finally {
            toggleButtonLoader(addManualSplitBtn, addManualSplitText, manualSplitLoader, false);
        }
    });

    // --- STAGE 2 LOGIC ---
    confirmSplitBtn.addEventListener('click', () => {
        const splitItems = document.querySelectorAll('.split-item');
        if (splitItems.length === 0) { showMessage('請至少保留一個切割方案。', 'error'); return; }
        confirmed_splits = Array.from(splitItems).map(item => {
            const previewHref = item.querySelector('.preview-btn').href;
            return {
                tag: item.querySelector('.tag-name-input').value,
                start: item.querySelector('.page-start-input').value,
                end: item.querySelector('.page-end-input').value,
                filename: previewHref.includes('/api/preview_pdf/') ? previewHref.split('/').pop() : null
            };
        });
        
        populateSelects();
        col2.classList.remove('disabled-ui');
        showMessage('切割方案已儲存，請選擇一個區塊來生成範例。', 'success');
    });

    const populateSelects = () => {
        splitSelect.innerHTML = '';
        finalSourceSelect.innerHTML = '';
        
        const originalPdfOption = new Option(`原始完整 PDF (${original_filename})`, JSON.stringify({ type: 'original' }));
        finalSourceSelect.appendChild(originalPdfOption);

        confirmed_splits.forEach(split => {
            if (!split.filename) return;
            const optionText = `${split.tag} (頁數: ${split.start}-${split.end})`;
            splitSelect.appendChild(new Option(optionText, JSON.stringify(split)));
            finalSourceSelect.appendChild(new Option(optionText, JSON.stringify({ type: 'split', filename: split.filename })));
        });
    };

    generateExampleBtn.addEventListener('click', async () => {
        if (!splitSelect.value) { showMessage('請先選擇一個功能區塊。', 'error'); return; }
        
        currentAbortController = new AbortController();
        exampleLoader.classList.remove('hidden');
        generateExampleBtn.disabled = true;
        
        try {
            const response = await fetch('/api/generate_examples', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id,
                    filename: original_filename,
                    split: JSON.parse(splitSelect.value),
                    model_name: getSelectedModel(2)
                }),
                signal: currentAbortController.signal
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || '範例生成失敗');
            exampleTextarea.value = data.examples;
        } catch (error) {
            if (error.name === 'AbortError') {
                showMessage('範例生成已取消。', 'info');
            } else {
                showMessage(`範例生成失敗: ${error.message}`, 'error');
            }
        } finally {
            exampleLoader.classList.add('hidden');
            generateExampleBtn.disabled = false;
            currentAbortController = null;
        }
    });

    // --- STAGE 3 LOGIC ---
    confirmExampleBtn.addEventListener('click', () => {
        if (exampleTextarea.value.trim() === '') {
            showMessage('範例內容不能為空。', 'error');
            return;
        }
        finalExamplePreview.textContent = exampleTextarea.value;
        col3.classList.remove('disabled-ui');
        showMessage('範例已鎖定，可以進行最終生成！', 'success');
    });
    
    generateFinalBtn.addEventListener('click', async () => {
        currentAbortController = new AbortController();
        finalLoader.classList.remove('hidden');
        generateFinalBtn.disabled = true;

        try {
            const response = await fetch('/api/generate_final_csv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id,
                    filename: original_filename,
                    examples: exampleTextarea.value,
                    model_name: getSelectedModel(3),
                    source: JSON.parse(finalSourceSelect.value)
                }),
                signal: currentAbortController.signal
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || '最終檔案生成失敗');
            }
            
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'final_test_cases.csv';
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
            showMessage('最終測試案例 CSV 已成功下載！', 'success');
        } catch (error) {
            if (error.name === 'AbortError') {
                showMessage('最終生成已取消。', 'info');
            } else {
                showMessage(`最終生成失敗: ${error.message}`, 'error');
            }
        } finally {
            finalLoader.classList.add('hidden');
            generateFinalBtn.disabled = false;
            currentAbortController = null;
        }
    });
});