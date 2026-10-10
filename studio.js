'use strict';

const API = 'http://localhost:8000';
const SESSION_KEY = 'aura-study-workspace';
const state = {
    notes: [], slides: [], slide: 0, blob: null, audioUrl: null, recorder: null,
    stream: null, startedAt: 0, timer: null, id: null, urls: [], busy: false,
    transcript: '', duration: 0, pdf: null, pdfPage: 1, livePcm: [], livePcmSamples: 0, liveOffset: 0,
    liveBusy: false, liveTimer: null, liveAudioContext: null, liveSource: null, liveProcessor: null, liveSampleRate: 16000,
    study: { summary: '', flashcards: [], quiz: [] }
};
const time = (seconds) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const active = () => state.recorder && state.recorder.state === 'recording';
const position = () => active() ? (performance.now() - state.startedAt) / 1000 : (($('audio').currentTime || 0));
const setStatus = (message) => { $('status').textContent = message; };
const setAiStatus = (message) => { const el = $('ai-status'); if (el) el.textContent = message; else setStatus(message); };
const showLoading = (message) => { const overlay = $('loading-overlay'); if (overlay && $('loading-message')) { $('loading-message').textContent = message; overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false'); } };
const updateLoading = (message) => { const overlay = $('loading-overlay'); if (overlay && overlay.classList.contains('open')) $('loading-message').textContent = message; };
const hideLoading = () => { const overlay = $('loading-overlay'); if (overlay) { overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true'); } };
const filename = () => ($('title').value.trim() || 'lecture').replace(/[^a-z0-9_-]/gi, '-').slice(0, 80);
const debug = (message, details) => {
    if (details === undefined) console.info('[Aura Studio]', message);
    else console.info('[Aura Studio]', message, details);
};

function renderTimeline() {
    const progress = $('timeline-progress');
    const events = $('timeline-events');
    if (!progress || !events) return;
    const duration = state.blob ? ($('audio').duration || state.duration) : Math.max(state.duration, position(), 1);
    progress.style.width = `${Math.min(100, (position() / duration) * 100)}%`;
    const timeLabel = $('transport-time');
    if (timeLabel) timeLabel.textContent = state.blob ? `${time(position())} / ${time(duration)}` : time(position());
    const play = $('play');
    if (play) {
        play.disabled = !state.blob;
        play.textContent = state.blob && !$('audio').paused ? '⏸' : '▶';
    }
    events.replaceChildren();
    state.notes.forEach((note) => {
        const marker = document.createElement('button');
        marker.className = 'timeline-marker';
        marker.style.left = `${Math.min(100, (note.at / duration) * 100)}%`;
        marker.title = `${time(note.at)} ${note.text}`;
        marker.textContent = '•';
        marker.onclick = (event) => { event.stopPropagation(); if (state.blob) { $('audio').currentTime = note.at; syncSlideToTime(note.at); } };
        events.append(marker);
    });
}

function syncSlideToTime(seconds) {
    if (!state.slides.length) return;
    const marks = state.notes.filter((note) => note.slide != null && note.at <= seconds + 0.5);
    if (!marks.length) return;
    const latest = marks.reduce((a, b) => (a.at >= b.at ? a : b));
    const item = state.slides[state.slide];
    if (item && item.type === 'application/pdf') {
        const pageMatch = latest.text && latest.text.match(/page\s+(\d+)/i);
        const page = pageMatch ? parseInt(pageMatch[1], 10) : state.pdfPage;
        if (page !== state.pdfPage && state.pdf) { state.pdfPage = page; renderSlide(); }
    } else if (latest.slide !== state.slide) {
        state.slide = latest.slide;
        renderSlide();
    }
}

function renderNotes() {
    const list = $('notes');
    list.replaceChildren();
    const query = ($('note-search')?.value || '').trim().toLowerCase();
    const visibleNotes = state.notes.filter((note) => !query || note.text.toLowerCase().includes(query));
    $('note-count').textContent = `${state.notes.length} note${state.notes.length === 1 ? '' : 's'}`;
    visibleNotes.forEach((note) => {
        const li = document.createElement('li');
        li.className = note.kind === 'transcript' || note.kind === 'live-transcript' ? 'transcript-note' : 'manual-note';
        const jump = document.createElement('button');
        jump.className = 'note-time';
        jump.textContent = time(note.at);
        jump.title = 'Jump to this moment';
        jump.onclick = () => { if (state.blob) $('audio').currentTime = note.at; };
        const text = document.createElement('span');
        text.textContent = note.text;
        li.append(jump, text);
        list.append(li);
    });
    renderTimeline();
    renderNotesView();
}

function addNote(text, slide) {
    state.notes.push({ text, at: Math.max(0, position()), ...(slide == null ? {} : { slide }) });
    renderNotes();
    saveStudySnapshot();
}

function renderSlideMessage(message) {
    const target = $('slide-screen');
    target.replaceChildren();
    const p = document.createElement('p');
    p.textContent = message;
    target.append(p);
}

async function renderSlide() {
    state.urls.forEach(URL.revokeObjectURL);
    state.urls = [];
    const target = $('slide-screen');
    target.replaceChildren();
    const item = state.slides[state.slide];
    if (!item) {
        renderSlideMessage('Upload slides to get started.');
        $('slide-label').textContent = 'No slides yet';
        $('prev').disabled = $('next').disabled = true;
        return;
    }
    if (item.type === 'application/pdf') {
        try {
            if (!state.pdf) {
                const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs');
                pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
                state.pdf = await pdfjs.getDocument({ data: await item.file.arrayBuffer() }).promise;
            }
            const page = await state.pdf.getPage(state.pdfPage);
            const viewport = page.getViewport({ scale: 1 });
            const scale = Math.min(($('slide-screen').clientWidth - 24) / viewport.width, ($('slide-screen').clientHeight - 24) / viewport.height);
            const scaled = page.getViewport({ scale: Math.max(.1, scale) });
            const canvas = document.createElement('canvas');
            canvas.width = scaled.width; canvas.height = scaled.height; canvas.className = 'slide-canvas';
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: scaled }).promise;
            target.append(canvas);
            $('slide-label').textContent = `PDF page ${state.pdfPage} / ${state.pdf.numPages}`;
        } catch (error) {
            renderSlideMessage(`Could not render this PDF: ${error.message}`);
        }
    } else {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(item.file);
        state.urls.push(img.src);
        img.alt = item.name;
        target.append(img);
        $('slide-label').textContent = `${state.slide + 1} / ${state.slides.length}`;
    }
    $('prev').disabled = state.slide === 0 && state.pdfPage === 1;
    $('next').disabled = item.type === 'application/pdf' ? state.pdfPage >= (state.pdf?.numPages || 1) : state.slide >= state.slides.length - 1;
}

function changeSlide(delta) {
    const item = state.slides[state.slide];
    if (item?.type === 'application/pdf') {
        state.pdfPage += delta;
        if (state.pdfPage < 1) state.pdfPage = 1;
        if (state.pdf && state.pdfPage > state.pdf.numPages) state.pdfPage = state.pdf.numPages;
    } else {
        state.slide = Math.max(0, Math.min(state.slides.length - 1, state.slide + delta));
    }
    renderSlide();
    if (active()) addNote(`Slide ${state.slide + 1}${item?.type === 'application/pdf' ? `, page ${state.pdfPage}` : ''}`, state.slide);
}

$('slides').onchange = (event) => {
    const files = Array.from(event.target.files);
    if (!files.length) return;
    if (files.some((file) => !['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type))) return setStatus('Choose PNG, JPEG, WebP or PDF files.');
    if (files.some((file) => file.type === 'application/pdf') && files.length > 1) return setStatus('Choose one PDF, or multiple images.');
    state.slides = files.map((file) => ({ file, type: file.type, name: file.name }));
    state.slide = 0; state.pdfPage = 1; state.pdf = null;
    renderSlide(); setStatus('Slides loaded and scaled to fit the slide box. Save the session to keep them.');
};
$('prev').onclick = () => changeSlide(-1);
$('next').onclick = () => changeSlide(1);
$('mark').onclick = () => {
    if (!state.slides.length) return setStatus('Upload your slides first.');
    addNote(state.slides[state.slide].type === 'application/pdf' ? `PDF page ${state.pdfPage}` : `Slide ${state.slide + 1}`, state.slide);
    setStatus('Slide moment marked.');
};
$('note-form').onsubmit = (event) => {
    event.preventDefault();
    const value = $('note').value.trim();
    if (value) { addNote(value, state.slides.length ? state.slide : null); $('note').value = ''; $('note').focus(); }
};

function setAudio(blob) {
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.blob = blob; state.audioUrl = blob ? URL.createObjectURL(blob) : null;
    $('audio').hidden = !blob;
    if (blob) $('audio').src = state.audioUrl; else { $('audio').removeAttribute('src'); $('audio').load(); }
    $('download-audio').disabled = !blob;
    renderTimeline();
}
function lock(value) { state.busy = value; ['record', 'new', 'save', 'slides', 'audio-import'].forEach((id) => $(id).disabled = value); }

let whisper;
async function transcribeBlob(blob) {
    debug('transcription requested', { type: blob.type, bytes: blob.size });
    if (!whisper) {
        debug('creating Whisper wrapper');
        whisper = new WhisperWrapper({
            debug: true,
            onProgress: (progress) => {
                const percent = Math.round(progress * 100);
                updateLoading(`Installing Whisper model: ${percent}% downloaded…`);
                debug(`Whisper model progress ${percent}%`);
            },
            onStatus: (stage, message) => {
                debug(`Whisper status: ${stage}`, message);
                if (stage === 'loading') updateLoading(message);
            },
            onLog: (line) => console.debug('[Whisper engine]', line),
        });
    }
    if (!whisper.ready) {
        updateLoading('Loading Whisper engine and installing model…');
        debug('initialising Whisper engine and model');
        await whisper.init();
        debug('Whisper engine and model ready');
    }
    const result = await whisper.transcribe(blob);
    debug('transcription result', { segments: result.segments.length, duration: result.duration, characters: result.text.length });
    state.transcript = result.text; state.duration = result.duration;
    return result;
}

async function transcribeLongAudioFile(file) {
    debug('using streaming transcription fallback for long audio', { bytes: file.size });
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('This browser cannot stream audio for transcription');
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    audio.src = url;
    audio.preload = 'metadata';
    audio.controls = false;
    audio.style.display = 'none';
    document.body.append(audio);
    const context = new AudioContextClass({ sampleRate: 16000 });
    const source = context.createMediaElementSource(audio);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(context.destination);
    const chunks = [];
    let samples = 0;
    let offset = 0;
    let processing = Promise.resolve();
    let failed = null;
    const chunkSamples = 8 * 16000;
    const consume = () => {
        while (samples >= chunkSamples) {
            const input = new Float32Array(chunkSamples);
            let written = 0;
            while (written < chunkSamples && chunks.length) {
                const first = chunks[0];
                const amount = Math.min(first.length, chunkSamples - written);
                input.set(first.subarray(0, amount), written);
                written += amount;
                samples -= amount;
                if (amount === first.length) chunks.shift();
                else chunks[0] = first.subarray(amount);
            }
            const start = offset;
            offset += input.length / 16000;
            processing = processing.then(async () => {
                debug('transcribing streamed file chunk', { start, seconds: 8 });
                const result = await transcribeBlob(input);
                result.segments.forEach((segment) => state.notes.push({
                    at: start + segment.start,
                    text: segment.text,
                    kind: 'transcript'
                }));
                renderNotes();
                updateLoading(`Transcribing long audio: ${time(offset)} processed…`);
            }).catch((error) => { failed = error; });
        }
    };
    processor.onaudioprocess = (event) => {
        if (failed) return;
        const input = event.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(input));
        samples += input.length;
        consume();
    };
    try {
        state.notes = state.notes.filter((note) => note.kind !== 'transcript');
        renderNotes();
        await context.resume();
        await new Promise((resolve, reject) => {
            audio.onloadedmetadata = () => {
                state.duration = Number.isFinite(audio.duration) ? audio.duration : 0;
                debug('long audio metadata loaded', { duration: state.duration });
                audio.play().then(resolve).catch(reject);
            };
            audio.onerror = () => reject(new Error('The browser could not play this audio format'));
        });
        await new Promise((resolve) => {
            audio.onended = resolve;
            const waitForProcessing = () => {
                if (audio.ended) resolve();
                else setTimeout(waitForProcessing, 250);
            };
            waitForProcessing();
        });
        if (samples) {
            const remainder = new Float32Array(samples);
            let written = 0;
            while (chunks.length) {
                const first = chunks.shift();
                remainder.set(first.subarray(0, Math.min(first.length, remainder.length - written)), written);
                written += first.length;
            }
            const start = offset;
            processing = processing.then(async () => {
                const result = await transcribeBlob(remainder);
                result.segments.forEach((segment) => state.notes.push({ at: start + segment.start, text: segment.text, kind: 'transcript' }));
                renderNotes();
            });
        }
        await processing;
        if (failed) throw failed;
        state.transcript = state.notes.filter((note) => note.kind === 'transcript').map((note) => note.text).join(' ');
        return { duration: state.duration };
    } finally {
        audio.pause();
        processor.disconnect();
        source.disconnect();
        silentGain.disconnect();
        await context.close();
        URL.revokeObjectURL(url);
        audio.remove();
    }
}

async function transcribeLiveChunk() {
    const chunkSamples = 8 * 16000;
    if (state.livePcmSamples < chunkSamples || state.liveBusy) return;
    const input = takeLivePcm(chunkSamples);
    debug('transcribing live PCM chunk', { samples: input.length, seconds: input.length / 16000, offset: state.liveOffset });
    state.liveBusy = true;
    try {
        const result = await transcribeBlob(input);
        result.segments.forEach((segment) => state.notes.push({ at: state.liveOffset + segment.start, text: segment.text, kind: 'live-transcript' }));
        state.liveOffset += result.duration;
        renderNotes();
        setStatus('Recording live. Whisper is adding transcript segments to the timeline…');
    } catch (error) {
        setStatus(`Recording live, but Whisper could not transcribe the latest segment: ${error.message}`);
    } finally {
        state.liveBusy = false;
    }
}

function takeLivePcm(sampleCount) {
    const output = new Float32Array(sampleCount);
    let written = 0;
    while (written < sampleCount && state.livePcm.length) {
        const first = state.livePcm[0];
        const amount = Math.min(first.length, sampleCount - written);
        output.set(first.subarray(0, amount), written);
        written += amount;
        state.livePcmSamples -= amount;
        if (amount === first.length) state.livePcm.shift();
        else state.livePcm[0] = first.subarray(amount);
    }
    return output.subarray(0, written);
}

function startLivePcmCapture(stream) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Live PCM capture is not supported in this browser');
    state.liveAudioContext = new AudioContextClass({ sampleRate: 16000 });
    state.liveSampleRate = state.liveAudioContext.sampleRate;
    state.liveSource = state.liveAudioContext.createMediaStreamSource(stream);
    state.liveProcessor = state.liveAudioContext.createScriptProcessor(4096, 1, 1);
    state.liveProcessor.onaudioprocess = (event) => {
        const source = event.inputBuffer.getChannelData(0);
        const samples = state.liveSampleRate === 16000
            ? new Float32Array(source)
            : resamplePcm(source, state.liveSampleRate, 16000);
        state.livePcm.push(samples);
        state.livePcmSamples += samples.length;
    };
    state.liveSource.connect(state.liveProcessor);
    state.liveProcessor.connect(state.liveAudioContext.destination);
    debug('live PCM capture started', { sampleRate: state.liveAudioContext.sampleRate });
}

function resamplePcm(input, fromRate, toRate) {
    const output = new Float32Array(Math.round(input.length * toRate / fromRate));
    for (let i = 0; i < output.length; i++) {
        const position = i * fromRate / toRate;
        const left = Math.floor(position);
        const right = Math.min(left + 1, input.length - 1);
        output[i] = input[left] + (input[right] - input[left]) * (position - left);
    }
    return output;
}

async function stopLivePcmCapture() {
    if (state.liveProcessor) state.liveProcessor.disconnect();
    if (state.liveSource) state.liveSource.disconnect();
    if (state.liveAudioContext) await state.liveAudioContext.close();
    state.liveProcessor = null; state.liveSource = null; state.liveAudioContext = null;
}

async function finishRecording(blob, shouldTranscribe = true) {
    clearInterval(state.liveTimer);
    await stopLivePcmCapture();
    while (state.liveBusy) await new Promise((resolve) => setTimeout(resolve, 100));
    if (state.livePcmSamples) {
        const input = takeLivePcm(state.livePcmSamples);
        if (input.length) {
            debug('transcribing final live PCM remainder', { samples: input.length, seconds: input.length / 16000, offset: state.liveOffset });
            try {
                const result = await transcribeBlob(input);
                result.segments.forEach((segment) => state.notes.push({ at: state.liveOffset + segment.start, text: segment.text, kind: 'live-transcript' }));
                state.liveOffset += result.duration;
            } catch (error) {
                debug('final live PCM transcription failed', error);
            }
        }
    }
    state.notes = state.notes.filter((note) => note.kind !== 'live-transcript');
    setAudio(blob); state.duration = blob ? state.duration : 0;
    if (shouldTranscribe && blob) {
        showLoading('Transcribing your recording…');
        try {
            const result = await transcribeBlob(blob);
            state.notes = state.notes.filter((note) => note.kind !== 'live-transcript');
            result.segments.forEach((segment) => state.notes.push({ at: segment.start, text: segment.text, kind: 'transcript' }));
            renderNotes();
            hideLoading();
            setStatus(`Recording ready. Transcribed ${result.segments.length} timestamped segments.`);
        }
        catch (error) { hideLoading(); setStatus(`Recording ready, but transcription failed: ${error.message}`); }
    } else setStatus('Audio ready. Add notes or save the session.');
    $('record').classList.remove('recording'); lock(false); $('stop').disabled = true; saveStudySnapshot();
}

$('record').onclick = async () => {
    if (state.blob) return setStatus('Start a new session before recording again. Save this one first.');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return setStatus('Recording needs HTTPS or localhost and a supported browser.');
    lock(true); setStatus('Waiting for microphone permission…');
    try {
        state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const chunks = [];
        state.recorder = new MediaRecorder(state.stream);
        state.recorder.ondataavailable = (event) => {
            if (event.data.size) {
                chunks.push(event.data);
            }
        };
        state.recorder.onstop = () => { clearInterval(state.timer); state.stream.getTracks().forEach((track) => track.stop()); finishRecording(new Blob(chunks, { type: state.recorder.mimeType || 'audio/webm' })); };
        state.startedAt = performance.now(); state.duration = 0; state.livePcm = []; state.livePcmSamples = 0; state.liveOffset = 0;
        startLivePcmCapture(state.stream);
        debug('recording started', { requestedSampleRate: 16000, actualSampleRate: state.liveSampleRate });
        state.recorder.start(1000);
        state.liveTimer = setInterval(transcribeLiveChunk, 8000);
        state.timer = setInterval(() => { state.duration = (performance.now() - state.startedAt) / 1000; $('clock').textContent = time(state.duration); renderTimeline(); }, 250);
        $('stop').disabled = false; $('record').classList.add('recording'); setStatus('Recording live. Add notes; Whisper will build timestamped transcript segments when you stop.');
    } catch (error) { if (state.stream) state.stream.getTracks().forEach((track) => track.stop()); lock(false); setStatus(`Could not start recording: ${error.message}`); }
};
$('stop').onclick = () => { if (active()) { $('stop').disabled = true; state.recorder.stop(); setStatus('Finishing recording and transcribing…'); } };
$('audio-import').onchange = async (event) => {
    const file = event.target.files[0]; if (!file) return;
    lock(true); showLoading('Importing and transcribing audio…');
    try {
        setAudio(file);
        const result = file.size > 20 * 1024 * 1024
            ? await transcribeLongAudioFile(file)
            : await transcribeBlob(file);
        if (file.size <= 20 * 1024 * 1024) {
            state.notes = state.notes.filter((note) => note.kind !== 'transcript');
            result.segments.forEach((segment) => state.notes.push({ at: segment.start, text: segment.text, kind: 'transcript' }));
            renderNotes();
        }
        hideLoading();
        setStatus(`Audio imported and transcript added to the timeline.`);
    }
    catch (error) { hideLoading(); setStatus(`Audio imported, but transcription failed: ${error.message}`); }
    finally { lock(false); saveStudySnapshot(); }
};
$('audio').onplay = renderTimeline;
$('audio').onpause = renderTimeline;
$('audio').ontimeupdate = () => { renderTimeline(); syncSlideToTime($('audio').currentTime); };
const playButton = $('play');
if (playButton) playButton.onclick = () => { const audio = $('audio'); if (audio.paused) audio.play(); else audio.pause(); };
const transportTrack = $('transport-track');
if (transportTrack) transportTrack.onclick = (event) => {
    if (!state.blob || event.target.classList.contains('timeline-marker')) return;
    const rect = transportTrack.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const audio = $('audio');
    if (audio.duration) { audio.currentTime = ratio * audio.duration; syncSlideToTime(audio.currentTime); }
};

function download(blob, name) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
$('export').onclick = () => download(new Blob([`${$('title').value}\n\n${state.transcript ? `Transcript\n${state.transcript}\n\n` : ''}${state.notes.map((note) => `${time(note.at)}  ${note.text}`).join('\n')}`], { type: 'text/plain' }), `${filename()}-notes.txt`);
$('download-audio').onclick = () => { if (state.blob) download(state.blob, `${filename()}.${state.blob.type.includes('mp4') ? 'm4a' : state.blob.type.includes('ogg') ? 'ogg' : 'webm'}`); };

function saveStudySnapshot() {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ title: $('title').value, notes: state.notes, transcript: state.transcript, study: state.study })); } catch (error) { setStatus(`Could not save study data in this session: ${error.message}`); }
}
function loadStudySnapshot() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
        if (!saved) return;
        if (saved.title) $('title').value = saved.title;
        state.notes = Array.isArray(saved.notes) ? saved.notes : [];
        state.transcript = saved.transcript || ''; state.study = { summary: '', flashcards: [], quiz: [], ...(saved.study || {}) }; renderNotes(); renderStudy();
    } catch (error) { setStatus(`Could not restore study data: ${error.message}`); }
}

async function ai(path, body) {
    debug('sending API request', { path, payload: body });
    const response = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    debug('API response received', { path, status: response.status });
    if (!response.ok) throw new Error(`AI server returned HTTP ${response.status}`);
    const envelope = await response.json();
    debug('API response parsed', { path, keys: Object.keys(envelope || {}) });
    if (envelope && envelope.status === 'success' && Object.prototype.hasOwnProperty.call(envelope, 'data')) {
        debug('unwrapped API response data', { path, keys: Object.keys(envelope.data || {}) });
        return envelope.data;
    }
    return envelope;
}
function sourceText() { return [state.transcript, ...state.notes.map((note) => `[${time(note.at)}] ${note.text}`)].filter(Boolean).join('\n'); }
function textFromResponse(value) { return typeof value === 'string' ? value : (value.summary || value.text || value.result || JSON.stringify(value, null, 2)); }
function renderStudy() {
    renderNotesView();
    const summary = $('summary-output');
    if (!summary || !$('flashcards-output') || !$('quiz-output')) return;
    summary.replaceChildren();
    if (!state.study.summary) {
        summary.textContent = 'No summary yet.';
    } else if (typeof state.study.summary === 'string') {
        summary.textContent = state.study.summary;
    } else {
        const title = document.createElement('h3');
        title.textContent = state.study.summary.title || 'Lecture Notes';
        summary.append(title);
        const overview = document.createElement('p');
        overview.textContent = state.study.summary.summary || '';
        summary.append(overview);
        (state.study.summary.sections || []).forEach((section) => {
            const article = document.createElement('article');
            article.className = 'summary-section';
            const heading = document.createElement('h4');
            heading.textContent = section.heading;
            const points = document.createElement('ul');
            (section.points || []).forEach((point) => { const li = document.createElement('li'); li.textContent = point; points.append(li); });
            article.append(heading, points);
            summary.append(article);
        });
        if (state.study.summary.key_terms?.length) {
            const terms = document.createElement('p');
            terms.className = 'key-terms';
            terms.textContent = `Key terms: ${state.study.summary.key_terms.join(' · ')}`;
            summary.append(terms);
        }
    }
    const cards = $('flashcards-output'); cards.replaceChildren();
    const flashcards = Array.isArray(state.study.flashcards)
        ? state.study.flashcards
        : state.study.flashcards?.flashcards || [];
    state.study.flashcards = flashcards;
    flashcards.forEach((card, index) => {
        const article = document.createElement('article');
        article.className = 'flashcard';
        const toggle = document.createElement('button');
        toggle.className = 'flashcard-toggle';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.textContent = `Card ${index + 1}`;
        const term = document.createElement('h3');
        term.textContent = card.term;
        const definition = document.createElement('p');
        definition.hidden = true;
        definition.textContent = card.definition;
        const hint = document.createElement('small');
        hint.textContent = 'Click to reveal definition';
        toggle.onclick = () => {
            definition.hidden = !definition.hidden;
            hint.hidden = !definition.hidden;
            toggle.setAttribute('aria-expanded', String(!definition.hidden));
        };
        article.append(toggle, term, definition, hint);
        cards.append(article);
    });
    const quiz = $('quiz-output'); quiz.replaceChildren();
    const questions = Array.isArray(state.study.quiz)
        ? state.study.quiz
        : state.study.quiz?.questions || [];
    state.study.quiz = questions;
    if (!questions.length) {
        quiz.textContent = 'No quiz yet.';
        return;
    }
    const score = questions.reduce((total, question) => total + (question.result?.mark || 0), 0);
    const possible = questions.reduce((total, question) => total + (question.marks || 0), 0);
    const scoreLabel = document.createElement('p');
    scoreLabel.className = 'quiz-score';
    scoreLabel.textContent = `Score: ${score} / ${possible} marks`;
    quiz.append(scoreLabel);
    questions.forEach((question, index) => {
        const form = document.createElement('form'); form.className = 'quiz-question';
        const heading = document.createElement('h3');
        heading.textContent = `${index + 1}. ${question.question} (${question.marks} mark${question.marks === 1 ? '' : 's'})`;
        form.append(heading);
        if (question.type === 'multiple_choice') {
            const options = document.createElement('div');
            options.className = 'quiz-options';
            Object.entries(question.options || {}).forEach(([key, value]) => {
                const label = document.createElement('label');
                label.className = 'quiz-option';
                label.innerHTML = `<input type="radio" name="question-${index}" value="${key}" required> <strong>${key}</strong> <span></span>`;
                label.querySelector('span').textContent = value;
                options.append(label);
            });
            form.append(options);
        } else {
            const label = document.createElement('label');
            label.textContent = 'Your answer';
            const textarea = document.createElement('textarea');
            textarea.required = true;
            label.append(textarea);
            form.append(label);
        }
        const submit = document.createElement('button');
        submit.className = 'btn light small';
        submit.textContent = 'Submit answer';
        form.append(submit);
        const feedback = document.createElement('div');
        feedback.className = 'quiz-feedback';
        if (question.result) renderMark(feedback, question.result);
        form.append(feedback);
        form.onsubmit = async (event) => {
            event.preventDefault();
            submit.disabled = true;
            feedback.textContent = 'Marking…';
            const selectedOption = question.type === 'multiple_choice'
                ? form.querySelector('input:checked')
                : null;
            const answer = selectedOption
                ? `${selectedOption.value}: ${question.options[selectedOption.value]}`
                : form.querySelector('textarea').value;
            try {
                const result = await ai('/api/mark', {
                    question: question.question,
                    user_answer: answer,
                    marking_guide: question.marking_guide,
                    max_marks: question.marks,
                    info: { title: $('title').value }
                });
                question.result = result;
                question.user_answer = answer;
                renderMark(feedback, result);
                saveStudySnapshot();
                const score = questions.reduce((total, item) => total + (item.result?.mark || 0), 0);
                const scorePossible = questions.reduce((total, item) => total + (item.marks || 0), 0);
                const scoreLabel = quiz.querySelector('.quiz-score');
                if (scoreLabel) scoreLabel.textContent = `Score: ${score} / ${scorePossible} marks`;
                submit.textContent = 'Answer marked';
            } catch (error) {
                feedback.textContent = error.message;
                submit.disabled = false;
            }

        };
        quiz.append(form);
    });
}

function showStudyView(viewName) {
    const views = document.querySelectorAll('.study-view');
    const tabs = document.querySelectorAll('.study-tab');
    const targetId = `${viewName}-view`;
    const target = document.getElementById(targetId);
    if (!target) {
        debug('study view not found', { viewName, targetId });
        return;
    }
    views.forEach((view) => { view.hidden = view !== target; });
    tabs.forEach((tab) => {
        const selected = tab.dataset.view === viewName;
        tab.classList.toggle('active', selected);
        tab.setAttribute('aria-selected', String(selected));
    });
    debug('study view selected', viewName);
}

function renderMark(container, result) {
    container.replaceChildren();
    const score = document.createElement('strong');
    score.textContent = `${result.mark} / ${result.max_marks} marks`;
    const feedback = document.createElement('p');
    feedback.textContent = result.feedback || '';
    container.append(score, feedback);
    if (result.criteria_met?.length) {
        const met = document.createElement('small');
        met.textContent = `Met: ${result.criteria_met.join('; ')}`;
        container.append(met);
    }
    if (result.criteria_missed?.length) {
        const missed = document.createElement('small');
        missed.textContent = `To improve: ${result.criteria_missed.join('; ')}`;
        container.append(missed);
    }
}

function renderNotesView() {
    const output = $('notes-output');
    if (!output) return;
    output.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'notes-view-heading';
    const title = document.createElement('h3');
    title.textContent = `${$('title').value.trim() || 'Lecture'} notes`;
    const count = document.createElement('span');
    count.className = 'fine';
    count.textContent = `${state.notes.length} timestamped entries`;
    heading.append(title, count);
    output.append(heading);
    if (state.transcript) {
        const transcriptHeading = document.createElement('h4');
        transcriptHeading.textContent = 'Transcript';
        const transcript = document.createElement('p');
        transcript.className = 'transcript-block';
        transcript.textContent = state.transcript;
        output.append(transcriptHeading, transcript);
    }
    const list = document.createElement('div');
    list.className = 'notes-view-list';
    state.notes.forEach((note) => {
        const row = document.createElement('button');
        row.className = 'notes-view-item';
        row.innerHTML = `<strong></strong><span></span>`;
        row.querySelector('strong').textContent = time(note.at);
        row.querySelector('span').textContent = note.text;
        row.onclick = () => { if (state.blob) $('audio').currentTime = note.at; };
        list.append(row);
    });
    output.append(list);
}
async function createStudy(kind) {
    const text = sourceText(); if (!text) return setAiStatus('Add notes or a transcript first.');
    debug(`AI ${kind} request started`, { characters: text.length });
    showLoading(`Creating ${kind}…`);
    try {
        if (kind === 'summary') state.study.summary = await ai('/api/summarise', { transcript: text, info: { title: $('title').value } });
        if (kind === 'flashcards') { const result = await ai('/api/flashcards', { transcript: text, info: { title: $('title').value } }); state.study.flashcards = result.flashcards || result.cards || (Array.isArray(result) ? result : []); }
        if (kind === 'quiz') { const result = await ai('/api/quiz', { notes: text, num_questions: 5, info: { title: $('title').value } }); state.study.quiz = result.questions || result.quiz || (Array.isArray(result) ? result : []); }
        renderStudy(); saveStudySnapshot(); hideLoading(); setAiStatus(`${kind[0].toUpperCase() + kind.slice(1)} saved in this browser.`); debug(`AI ${kind} request complete`);
    } catch (error) { debug(`AI ${kind} request failed`, error); hideLoading(); setAiStatus(`Could not reach AI server: ${error.message}`); }
}

function hasStudyContent(kind) {
    if (kind === 'summary') return !!state.study.summary;
    if (kind === 'flashcards') return (Array.isArray(state.study.flashcards) ? state.study.flashcards : state.study.flashcards?.flashcards || []).length > 0;
    if (kind === 'quiz') return (Array.isArray(state.study.quiz) ? state.study.quiz : state.study.quiz?.questions || []).length > 0;
    return false;
}
function openAiOverlay(kind) {
    const overlay = $(`${kind}-overlay`); if (!overlay) return;
    overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('overlay-open');
}
function closeAiOverlay(kind) {
    const overlay = $(`${kind}-overlay`); if (!overlay) return;
    overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.ai-overlay.open')) document.body.classList.remove('overlay-open');
}
async function toggleAiFeature(kind) {
    const overlay = $(`${kind}-overlay`);
    if (overlay && overlay.classList.contains('open')) { closeAiOverlay(kind); return; }
    openAiOverlay(kind);
    renderStudy();
    if (!hasStudyContent(kind)) await createStudy(kind);
}
$('ai-summary').onclick = () => toggleAiFeature('summary');
$('ai-flashcards').onclick = () => toggleAiFeature('flashcards');
$('ai-quiz').onclick = () => toggleAiFeature('quiz');
document.querySelectorAll('[data-close]').forEach((button) => {
    button.onclick = () => closeAiOverlay(button.dataset.close);
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        const open = document.querySelector('.ai-overlay.open');
        if (open) closeAiOverlay(open.id.replace('-overlay', ''));
    }
});
$('note-search').oninput = renderNotes;

const dbPromise = new Promise((resolve, reject) => { const request = indexedDB.open('lecture-studio', 2); request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('sessions')) request.result.createObjectStore('sessions', { keyPath: 'id' }); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
async function dbCall(mode, action) { const db = await dbPromise; return new Promise((resolve, reject) => { const tx = db.transaction('sessions', mode); const request = action(tx.objectStore('sessions')); let result; request.onsuccess = () => result = request.result; tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); }); }
async function listSessions() {
    const sessions = await dbCall('readonly', (store) => store.getAll()); $('sessions').replaceChildren();
    if (!sessions.length) { const empty = document.createElement('p'); empty.className = 'fine'; empty.textContent = 'Your saved lectures will appear here.'; $('sessions').append(empty); return; }
    sessions.sort((a, b) => b.updated - a.updated).forEach((session) => { const row = document.createElement('div'); row.className = 'saved-item'; const label = document.createElement('span'); label.textContent = `${session.title} · ${new Date(session.updated).toLocaleDateString()}`; const open = document.createElement('button'); open.className = 'btn light small'; open.textContent = 'Open'; open.onclick = () => { $('title').value = session.title; state.notes = session.notes || []; state.transcript = session.transcript || ''; state.slides = session.slides || []; state.slide = 0; state.pdf = null; setAudio(session.blob || null); renderNotes(); renderSlide(); renderStudy(); setStatus('Saved session opened.'); }; row.append(label, open); $('sessions').append(row); });
}
$('save').onclick = async () => { if (!state.blob && !state.notes.length) return setStatus('Add a recording or note before saving.'); try { const id = state.id || crypto.randomUUID(); state.id = id; await dbCall('readwrite', (store) => store.put({ id, title: $('title').value.trim() || 'Untitled lecture', notes: state.notes, transcript: state.transcript, slides: state.slides, blob: state.blob, updated: Date.now() })); saveStudySnapshot(); await listSessions(); setStatus('Session saved in this browser.'); } catch (error) { setStatus(`Could not save session: ${error.message}`); } };
$('new').onclick = () => { if (active()) return setStatus('Stop recording before starting a new session.'); if (state.notes.length && !confirm('Start a new session? Save your current work first.')) return; state.notes = []; state.slides = []; state.slide = 0; state.pdf = null; state.id = null; state.transcript = ''; state.study = { summary: '', flashcards: [], quiz: [] }; $('title').value = 'My next lecture'; $('note').value = ''; $('slides').value = ''; $('audio-import').value = ''; $('clock').textContent = '00:00'; setAudio(null); renderNotes(); renderSlide(); renderStudy(); sessionStorage.removeItem(SESSION_KEY); setStatus('A fresh start. Ready when you are.'); };
window.addEventListener('resize', () => { if (state.slides[state.slide]?.type === 'application/pdf') renderSlide(); });
loadStudySnapshot(); renderStudy(); renderSlide(); listSessions().catch((error) => setStatus(`Saved sessions unavailable: ${error.message}`));
