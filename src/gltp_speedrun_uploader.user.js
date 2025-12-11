// ==UserScript==
// @name         GLTP Speedrun Uploader
// @description  Upload private group speedrun replays to GLTP speedrun tracker + show WR HUD overlay
// @include      https://*.koalabeast.com/game*
// @include      https://*.koalabeast.com/game
// @include      https://*.koalabeast.com/game?*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @author       DAD.
// @version      0.1
// ==/UserScript==

/* globals tagpro, $, PIXI */

/*{
  "LapMap3": { "type": "individual", "caps_to_win": 3 },
  "RelayMap": { "type": "combined", "caps_to_win": 3 },
  "DefaultMap": { "type": "individual", "caps_to_win": 1 }
} */

(function() {
    'use strict';

    let mapConfig = {}; // loaded from JSON
    let fastestTime = Infinity;
    let wrHolder = "Unknown";
    console.log("starting1");

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
        const wrs  = await fetchJSON("https://gltp.fwotagprodad.workers.dev/wrs");

        for (const id in maps) {
            if (wrs[id]) {
                maps[id].fastestTime = wrs[id].fastestTime;
                maps[id].player = wrs[id].player;
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


    function isSpeedrunMap() {
        console.log("isspeedrunmap");
        const id = getCurrentMapId();
        console.log(id);
        console.log(mapConfig);
        return id && !!mapConfig[id];
    }

    function getMapRequirement() {
        console.log("getrequirement");
        const id = getCurrentMapId();
        return mapConfig[id] || { completion_type: "individual", caps_to_win: "1" };
    }

    function getFastestTime() {
        console.log("getfastesttime");
        const id = getCurrentMapId();
        const entry = mapConfig[id];
        return entry ? { fastestTime: entry.fastestTime, player: entry.player } 
                    : { fastestTime: Infinity, player: "Unknown" };
    }


    // -------------------------
    // UPLOAD REPLAY
    // -------------------------
    function getReplayUUID() {
        console.log("getReplay");        
        try {
            if (tagpro.clientInfo && tagpro.clientInfo.gameUuid) {
                return tagpro.clientInfo.gameUuid;
            }
            // Nothing found
            console.error("Replay UUID not found:", e);
            return null;
        } catch (e) {
            console.error("Replay UUID not found:", e);
            return null;
        }
    }

    async function uploadReplay(uuid, runTime) {
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
            console.error("Upload error:", err);
            updateOverlayStatus("❌ Upload request failed");
            return { ok: false, error: "Request failed" };
        }
    }


    // -------------------------
    // HUD OVERLAY
    // -------------------------
    function initOverlay() {
        GM_addStyle(`
            #WR_HUD {
                position: absolute;
                top: 60px;
                left: 20px;
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
                <h4>Speedrun WR</h4>
                <div id="WR_HUD_content">Loading fastest time...</div>
                <span class="status" id="WR_HUD_status"></span>
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
            isDragging = false;
        });
    }

    function showWRHUD(time, player) {
        let formatted = time && time !== Infinity ? time.toFixed(2) + "s" : "N/A";
        $("#WR_HUD_content").html(`Fastest: <b>${formatted}</b> by ${player || "Unknown"}`);
    }

    function updateOverlayStatus(message) {
        $("#WR_HUD_status").text(message);
    }

    function removeOverlay() {
        $("#WR_HUD").remove();
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
    // MAIN FLOW
    // -------------------------
    tagpro.ready(async function() {
        console.log("made it here");
        try {
            // Load both maps.json and wr.json, merge into mapConfig
            await loadConfigs();
        } catch (e) {
            console.error("Failed to load configs", e);
            return; // bail out if configs can’t be loaded
        }

        console.log("ok1");
        if (!isPrivateGroup()) return;
        console.log("ok2");
        if (!isSpeedrunMap()) return;
        console.log("ok3");

        initOverlay();

        const wrData = getFastestTime();
        fastestTime = wrData.fastestTime;
        wrHolder = wrData.player;
        showWRHUD(fastestTime, wrHolder);

        let startTime = null;
        let latestTime = null;
        let capsTracker = { red: 0, blue: 0 };

        tagpro.socket.on('time', function(data) {
            latestTime = data.time;
            if (data.state === 3 && !startTime) {
                startTime = data.time;
            }
        });

        tagpro.socket.on('score', function(scoreUpdate) {
            console.log("scored");
            if (scoreUpdate.r > capsTracker.red) capsTracker.red = scoreUpdate.r;
            if (scoreUpdate.b > capsTracker.blue) capsTracker.blue = scoreUpdate.b;

            const req = getMapRequirement();
            console.log("scored1");

            let completed = false;
            if (req.completion_type === "individual") {
                console.log('scored2');
                if (capsTracker.red >= req.caps_to_win || capsTracker.blue >= req.caps_to_win) {
                    console.log('scored3');
                    completed = true;
                }
            } else if (req.completion_type === "combined") {
                if ((capsTracker.red + capsTracker.blue) >= req.caps_to_win) {
                    completed = true;
                }
            }

            if (completed) {
                console.log('scored5');
                let runTime = (startTime - latestTime) / 1000;
                updateOverlayStatus("Run completed in " + runTime.toFixed(2) + "s");

                uploadReplay(getReplayUUID(), runTime).then(response => {
                    if (response.newWR) {
                        updateOverlayStatus("✅ New WR uploaded!");
                        showPixiTextAlert("New WR!", "#00ff00", "#ffffff", 64, 0, -200, 2000);
                        fastestTime = response.fastestTime;
                        wrHolder = response.player;
                        showWRHUD(fastestTime, wrHolder);
                    } else {
                        updateOverlayStatus("⚠️ Not a WR");
                    }
                }).catch(err => {
                    updateOverlayStatus("❌ Upload failed");
                });
            }
        });

        tagpro.socket.on('disconnect', function() {
            removeOverlay();
        });
    });
})();
