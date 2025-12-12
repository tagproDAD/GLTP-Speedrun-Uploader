// ==UserScript==
// @name         GLTP Speedrun Uploader + WR HUD overlay
// @description  Upload private group speedrun replays to GLTP speedrun tracker + show WR HUD overlay
// @include      https://*.koalabeast.com/game*
// @include      https://*.koalabeast.com/game
// @include      https://*.koalabeast.com/game?*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @author       DAD.
// @version      1.3
// ==/UserScript==

/* globals tagpro, $, PIXI */

/*{
  "LapMap3": { "type": "individual", "caps_to_win": 3 },
  "RelayMap": { "type": "combined", "caps_to_win": 3 },
  "DefaultMap": { "type": "individual", "caps_to_win": 1 }
} */

// -------------------------
// TOGGLE STATE
// -------------------------
const UPLOAD_ALL_DEFAULT = true;
let toggleCommandId = null; // track the current menu command

function shouldUploadRuns() {
    return GM_getValue("uploadAll", UPLOAD_ALL_DEFAULT);
}

function updateUploadToggleHUD() {
    const current = shouldUploadRuns();
    const statusBox = $("#WR_HUD_status");
    statusBox.find(".uploadToggle").remove();

    const line = $("<div>").addClass("uploadToggle");
    const icon = $("<span>").css({
        display: "inline-block",
        width: "12px",
        height: "12px",
        borderRadius: "50%",
        marginRight: "6px",
        backgroundColor: current ? "limegreen" : "red"
    });
    line.append(icon).append("Uploads: " + (current ? "ON" : "OFF"));
    statusBox.prepend(line);
}

function registerToggleCommand() {
    // Remove old command if it exists
    if (toggleCommandId !== null) {
        GM_unregisterMenuCommand(toggleCommandId);
    }

    const current = shouldUploadRuns();
    toggleCommandId = GM_registerMenuCommand(
        current ? "Disable Upload Runs" : "Enable Upload Runs",
        () => {
            GM_setValue("uploadAll", !current);
            registerToggleCommand(); // refresh menu label
            updateUploadToggleHUD(); // refresh HUD indicator
        }
    );
}

// Call once at script load
registerToggleCommand();

// Simple persistence wrapper for Tampermonkey
const State = {
    set(key, value) {
        try {
            GM_setValue(key, value);
        } catch (e) {
            console.error("Failed to save state", key, e);
        }
    },
    get(key, fallback = null) {
        try {
            return GM_getValue(key, fallback);
        } catch (e) {
            console.error("Failed to restore state", key, e);
            return fallback;
        }
    },
    remove(key) {
        try {
            GM_deleteValue(key);
        } catch (e) {
            console.error("Failed to delete state", key, e);
        }
    }
};


(function() {
    'use strict';

    let mapConfig = {}; // loaded from JSON
    let fastestTime = Infinity;
    let wrHolder = "Unknown";
    console.log("starting1");

    function formatTime(ms) {
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        const milliseconds = ms % 1000;

        if (hours > 0) {
            const minutesStr = minutes.toString().padStart(2, '0');
            const secondsStr = seconds.toString().padStart(2, '0');
            const millisStr = milliseconds.toString().padStart(3, '0');
            return `${hours}:${minutesStr}:${secondsStr}.${millisStr}`;
        } else if (minutes > 0) {
            const secondsStr = seconds.toString().padStart(2, '0');
            const millisStr = milliseconds.toString().padStart(3, '0');
            return `${minutes}:${secondsStr}.${millisStr}`;
        } else {
            const millisStr = milliseconds.toString().padStart(3, '0');
            return `${seconds}.${millisStr}`;
        }
    }

    function log(level, msg, data) {
        const ts = new Date().toISOString();
        if (data !== undefined) {
            console[level](`[${ts}] ${msg}`, data);
        } else {
            console[level](`[${ts}] ${msg}`);
        }
    }

    function isReplayMode() {
        return window.location.search.includes("replay=") || !!tagpro.replayData;
    }

    function isActivePlayer() {
        return tagpro.spectator === false;
    }

    function fetchJSON(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                onload: res => {
                    try {
                        const data = JSON.parse(res.responseText);
                        resolve(data);
                    } catch (e) {
                        reject(e);
                    }
                },
                onerror: err => reject(err)
            });
        });
    }

    // -------------------------
    // LOAD MAP CONFIG (requirements + WR data)
    // -------------------------
    async function loadConfigs() {
        const maps = await fetchJSON("https://bambitp.github.io/GLTP/map_metadata.json");
        const wrs = await fetchJSON("https://gltp.fwotagprodad.workers.dev/wrs");

        for (const id in maps) {
            if (wrs[id]) {
                maps[id].fastestTime = wrs[id].fastestTime;
                maps[id].playerTime = wrs[id].player_time;
                maps[id].minJumps = wrs[id].minJumps;
                maps[id].playerJumps = wrs[id].player_jumps;
            }
        }
        mapConfig = maps;
    }

    function isPrivateGroup() {
        if (tagpro.clientInfo && typeof tagpro.clientInfo.isPrivate !== "undefined") {
            return tagpro.clientInfo.isPrivate;
        }
        const el = document.getElementById("privateGame");
        return el && el.value === "true";
    }

    function getCurrentMapId() {
        if (tagpro.clientInfo && tagpro.clientInfo.mapfile) {
            const parts = tagpro.clientInfo.mapfile.split("/");
            return parts.length > 1 ? parts[1] : parts[0];
        }
        return null;
    }

    async function waitForMapId(maxRetries = 10, delayMs = 200) {
        for (let i = 0; i < maxRetries; i++) {
            const id = getCurrentMapId();
            if (id) return id;
            await new Promise(r => setTimeout(r, delayMs));
        }
        return null; // give up after retries
    }

    function isSpeedrunMap(id) {
        log("log", "map ID is: ", id);
        return id && !!mapConfig[id];
    }

    function getMapRequirement(id) {
        return mapConfig[id] || { completion_type: "individual", caps_to_win: "1", allow_blue_caps: false };
    }

function getFastestTime(id) {
    const entry = mapConfig[id];
    return entry ? {
        fastestTime: entry.fastestTime,
        playerTime: entry.playerTime,
        minJumps: entry.minJumps,
        playerJumps: entry.playerJumps
    } : {
        fastestTime: Infinity,
        playerTime: "Unknown",
        minJumps: Infinity,
        playerJumps: "Unknown"
    };
}



    // -------------------------
    // UPLOAD REPLAY
    // -------------------------
    function getReplayUUID() {        
        try {
            if (tagpro.clientInfo && tagpro.clientInfo.gameUuid) {
                return tagpro.clientInfo.gameUuid;
            }
            // Nothing found
            log("error", "Replay UUID not found");
            return null;
        } catch (e) {
            log("error", "Replay UUID not found", e);
            return null;
        }
    }

    async function uploadReplay(uuid, runTime) {
        if (isReplayMode()) {
            updateOverlayStatus("ℹ️ Replay mode detected, upload skipped");
            return { ok: true, status: "skipped" };
        }
        if (!isActivePlayer()) {
            updateOverlayStatus("ℹ️ Upload skipped (spectator/replay mode)");
            return { ok: true, status: "skipped_spectator" };
        }
        if (!shouldUploadRuns()) {
            updateOverlayStatus("ℹ️ Upload skipped (toggle OFF)");
            return { ok: true, status: "skipped" };
        }

        const playerName = tagpro.playerId && tagpro.players[tagpro.playerId]
            ? tagpro.players[tagpro.playerId].name
            : "Unknown";

        const payload = {
            input: uuid,
            origin: `tampermonkey script + ${playerName}`
        };

        try {
            const res = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "POST",
                    url: "https://gltp.fwotagprodad.workers.dev/delayed-upload",
                    data: JSON.stringify(payload),
                    headers: { "Content-Type": "application/json" },
                    onload: r => resolve(r),
                    onerror: e => reject(e)
                });
            });

            // Parse response
            const statusCode = res.status;
            let data;
            try {
                data = JSON.parse(res.responseText);
            } catch {
                data = null;
            }

            // Handle cases
            if (statusCode === 400) {
                updateOverlayStatus("❌ Invalid UUID format");
                return { ok: false, error: "Invalid UUID format" };
            }
            if (statusCode === 500) {
                updateOverlayStatus("❌ Failed to queue UUID");
                return { ok: false, error: "Failed to queue UUID" };
            }
            if (data && data.ok) {
                if (data.status === "already_queued") {
                    updateOverlayStatus("ℹ️ Replay already queued");
                } else if (data.status === "queued") {
                    updateOverlayStatus("✅ Replay queued successfully");
                }
                return data;
            }

            updateOverlayStatus("❌ Unexpected response");
            return { ok: false, error: "Unexpected response" };

        } catch (err) {
            log("error", "Upload error:", err);
            updateOverlayStatus("❌ Upload request failed");
            return { ok: false, error: "Request failed" };
        }
    }


    // -------------------------
    // HUD OVERLAY
    // -------------------------
    function initOverlay() {
        log("log", "Initializing Overlay");
        GM_addStyle(`
            #WR_HUD {
                position: absolute;
                top: ${localStorage.getItem("WR_HUD_top") || "120px"};
                left: ${localStorage.getItem("WR_HUD_left") || "20px"};
                padding: 6px 10px;
                background: rgba(20,20,20,0.8);
                border: 2px solid #4fa;
                border-radius: 6px;
                color: #eee;
                font-size: 14px;
                font-family: Arial, sans-serif;
                cursor: move;
                z-index: 9999;
            }
            #WR_HUD h4 {
                margin: 0 0 4px 0;
                font-size: 15px;
                color: chartreuse;
            }
            #WR_HUD span.status {
                display: block;
                margin-top: 4px;
                font-size: 13px;
                color: #ccc;
            }
        `);

        $("body").append(`
            <div id="WR_HUD">
                <h4>GLTP WR</h4>
                <div id="WR_HUD_content">Loading fastest time...</div>
                <div id="WR_HUD_timer">Time: 0.000</div>
                <div id="WR_HUD_status"></div>
            </div>
        `);

        // Draggable
        let isDragging = false, offsetX, offsetY;
        $("#WR_HUD").on("mousedown", function(e) {
            isDragging = true;
            offsetX = e.clientX - $(this).offset().left;
            offsetY = e.clientY - $(this).offset().top;
        });
        $(document).on("mousemove", function(e) {
            if (isDragging) {
                $("#WR_HUD").css({
                    top: e.clientY - offsetY,
                    left: e.clientX - offsetX
                });
            }
        }).on("mouseup", function() {
            if (isDragging) {
                localStorage.setItem("WR_HUD_top", $("#WR_HUD").css("top"));
                localStorage.setItem("WR_HUD_left", $("#WR_HUD").css("left"));
            }
            isDragging = false;
        });
    }

    function showWRHUD(time, player, minJumps, jumpPlayer) {
        let formattedTime = time && time !== Infinity ? formatTime(time) : "N/A";
        let formattedJumps = (minJumps !== undefined && minJumps !== Infinity) ? minJumps : "N/A";
        let jumpLine = `Least Jumps: <b>${formattedJumps}</b> by ${jumpPlayer || "Unknown"}`;

        $("#WR_HUD_content").html(`
            ${jumpLine}<br>
            Fastest: <b>${formattedTime}</b> by ${player || "Unknown"}
        `);
    }


    function updateOverlayStatus(message) {
        const statusBox = $("#WR_HUD_status");
        const line = $("<div>").text(message);
        statusBox.append(line);
    }


    function removeOverlay() {
        $("#WR_HUD").remove();
    }

    let timerInterval = null;
    let runStart = null;

    function startTimerOverlay() {
        log("log", "Starting Timer");
        stopTimerOverlay(); // clear any old loop

        function tick() {
            if (runStart) {
                const elapsed = Math.floor(performance.now() - runStart);
                $("#WR_HUD_timer").text("Time: " + formatTime(elapsed));
                timerInterval = requestAnimationFrame(tick);
            }
        }

        timerInterval = requestAnimationFrame(tick);
    }

    function stopTimerOverlay() {
        if (timerInterval) {
            cancelAnimationFrame(timerInterval);
            timerInterval = null;
        }
    }

    function syncTimerFromUI() {
        log("log", "Syncing Timer");
        if (restoreRunStart()) {
            return; // already restored, no need to sync from UI
        }

        // If overtime is active, anchor from extraTimeStartedAt
        if (tagpro.extraTimeStartedAt) {
            const elapsedOT = Date.now() - tagpro.extraTimeStartedAt;
            runStart = performance.now() - elapsedOT;
            State.set("runStart", runStart); // <-- save only here
            startTimerOverlay();
            updateOverlayStatus("⏱ Synced to overtime: " + formatTime(elapsedOT));
            return;
        }

        // Otherwise, use the UI timer text
        const txt = tagpro.ui.sprites.timer.text; // e.g. "01:12"
        if (txt) {
            const [mm, ss] = txt.split(":").map(Number);
            const elapsedMs = (mm * 60 + ss) * 1000;
            runStart = performance.now();
            startTimerOverlay();
            updateOverlayStatus("⏱ Start timer at game clock: " + txt);
        }
    }

    function saveRunStart() {
        const uuid = getReplayUUID();
        if (uuid && runStart) {
            const absoluteStart = Date.now() - (performance.now() - runStart);
            State.set("runStartAbs", absoluteStart); // save absolute wall-clock start
            State.set("runUUID", uuid);
            log("log", "Saved runStartAbs for UUID:", uuid, absoluteStart);
        }
    }

    function restoreRunStart() {
        const savedAbs = State.get("runStartAbs", null);
        const savedUUID = State.get("runUUID", null);
        const currentUUID = getReplayUUID();

        if (savedAbs && savedUUID && currentUUID === savedUUID) {
            // Convert absolute wall-clock back into current performance.now() baseline
            const elapsed = Date.now() - savedAbs;
            runStart = performance.now() - elapsed;
            startTimerOverlay();
            updateOverlayStatus("⏱ Restored runStart from saved state");
            log("log", "Restored runStart for UUID:", currentUUID, "elapsed:", elapsed);
            return true;
        }
        log("log", "No valid runStart to restore");
        return false;
    }

    function clearRunStart() {
        State.remove("runStartAbs");
        State.remove("runUUID");
        log("log", "Cleared runStart state");
    }

    // -------------------------
    // PIXI ALERTS
    // -------------------------
    function showPixiTextAlert(text, color1='#888888', color2='#ffffff', size=0, centerOffsetX=0, centerOffsetY=0, time=1000) {
        let textSprite = new PIXI.Text(text, {
            dropShadow: true,
            dropShadowAlpha: 0.5,
            dropShadowBlur: 8,
            fill: [color2, color1],
            fontSize: size,
            fontWeight: "bold",
            strokeThickness: 2
        });
        let vp = { x: $("#viewport").width() / 2, y: $("#viewport").height() / 2 };

        textSprite.x = Math.round(vp.x - textSprite.width / 2) + centerOffsetX;
        textSprite.y = Math.round(vp.y + centerOffsetY);

        requestAnimationFrame(function() {
            tagpro.renderer.layers.ui.addChild(textSprite);
            setTimeout(function() {
                tagpro.renderer.layers.ui.removeChild(textSprite);
            }, time);
        });
    }

    // -------------------------
    // Check Completion
    // -------------------------
    function checkCompletion(req) {
        const capsToWin = parseInt(req.caps_to_win, 10);
        const type = req.completion_type;
        const allowBlueCaps = req.allow_blue_caps === true;

        if (capsToWin <= 0) return false;

        if (type === "individual") {
            // Any single player reaching caps_to_win
            for (const id in tagpro.players) {
                const p = tagpro.players[id];
                if (!p) continue;
                if (p.team === 2 && !allowBlueCaps) continue; // skip blue if not allowed
                const caps = p["s-captures"] || 0;
                if (caps >= capsToWin) {
                    return true;
                }
            }
            return false;
        }

        if (type === "combined") {
            // Sum caps for teammates separately
            let redTotal = 0, blueTotal = 0;
            for (const id in tagpro.players) {
                const p = tagpro.players[id];
                if (!p) continue;
                if (p.team === 1) redTotal += p["s-captures"] || 0;
                if (p.team === 2 && allowBlueCaps) blueTotal += p["s-captures"] || 0;
            }
            if (redTotal >= capsToWin || blueTotal >= capsToWin) {
                return true;
            }
            return false;
        }

        return false;
    }

    // -------------------------
    // MAIN FLOW
    // -------------------------
    tagpro.ready(async function() {
        try {
            // Load both maps.json and wr.json, merge into mapConfig
            await loadConfigs();
        } catch (e) {
            log("error", "Failed to load configs", e);
            return; // bail out if configs can’t be loaded
        }

        if (!isPrivateGroup()) {
            log("log", "Not a private group");
            return;
        }
        const mapId = await waitForMapId();
        if (!mapId) {
            log("error", "Map ID not found after retries");
            return;
        }
        if (!isSpeedrunMap(mapId)) {
            log("log", "Not a GLTP map");
            return;
        }

        initOverlay();
        log("log", "updating toggle");
        updateUploadToggleHUD(); // show initial toggle state in HUD

        const wrData = getFastestTime(mapId);
        fastestTime = wrData.fastestTime;
        wrHolder    = wrData.playerTime;
        const minJumps   = wrData.minJumps;
        const jumpHolder = wrData.playerJumps;

        showWRHUD(fastestTime, wrHolder, minJumps, jumpHolder);

        // If game already running when we join, sync immediately
        if (tagpro.state === 1 || tagpro.state === 5) {
            syncTimerFromUI();
        }

        tagpro.socket.on('time', function(data) {
            log("log", "Time Socket", data);
            if (data.state === 1 && !runStart) {
                log("log", "start of game");
                runStart = performance.now(); // record wall‑clock start
                saveRunStart();
                startTimerOverlay();
            }
        });

        let runCompleted = false; // global flag

        tagpro.socket.on('score', function(scoreUpdate) {
            log("log", "Score Socket");

            // If we've already processed a completion, ignore further scores
            if (runCompleted) {
                return;
            }

            setTimeout(() => {
                const req = getMapRequirement(mapId);

                if (checkCompletion(req)) {
                    log("log", "Map Completed");
                    runCompleted = true;
                    const runTime = Math.floor(performance.now() - runStart) //elapsed in ms
                    stopTimerOverlay(); // freeze timer at final value
                    updateOverlayStatus("✅ Run completed in " + formatTime(runTime));

                    uploadReplay(getReplayUUID(), runTime).then(response => {
                        // Local WR estimate check
                        if (fastestTime !== Infinity && runTime - 3 * 1000 <= fastestTime) {
                            updateOverlayStatus("🌟 Might be a new WR!");
                            showPixiTextAlert("Might be a new WR!", "#00ff00", "#ffffff", 64, 0, -200, 4000);
                        } else {
                            updateOverlayStatus("⚠️ Not a WR");
                        }
                    }).catch(err => {
                        log("error", "Upload failed", err);
                        updateOverlayStatus("❌ Upload failed");
                    });
                }
            }, 150);
        });

        tagpro.socket.on("end", function(data) {
            stopTimerOverlay(); // freeze timer
            clearRunStart();
        });

        tagpro.socket.on('disconnect', function() {
            stopTimerOverlay();
            clearRunStart();
            removeOverlay();
        });
    });
})();
