// Makes game sound work on iPhone Safari. Loaded before the engine by
// tools/build_web.py.
// 1. iOS mutes Web Audio while the ring/silent switch is on silent; asking
//    for the "playback" audio session (iOS 17+) plays like a video does.
//    Older iOS gets the same effect from a looping silent <audio> element.
// 2. Safari only lets an AudioContext start inside the touch handler
//    itself, but Godot handles input a frame later, so resume every
//    context here, synchronously, on each touch, click or key press.
(function () {
	'use strict';
	const Base = window.AudioContext || window.webkitAudioContext;
	if (!Base) {
		return;
	}
	const contexts = [];
	function TrackedAudioContext(options) {
		const context = new Base(options);
		contexts.push(context);
		return context;
	}
	TrackedAudioContext.prototype = Base.prototype;
	window.AudioContext = TrackedAudioContext;
	if (window.webkitAudioContext) {
		window.webkitAudioContext = TrackedAudioContext;
	}
	// Exposed for the build check in tools/web_audio_check.py.
	window.pvzAudio = { contexts: contexts };

	const SILENT_WAV = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';
	let silentPlayer = null;
	if (navigator.audioSession) {
		try {
			navigator.audioSession.type = 'playback';
		} catch (error) {
			// Read-only on some builds; the silent player below is not
			// needed there because those builds ignore the switch anyway.
		}
	}

	function startSilentPlayer() {
		if (navigator.audioSession || silentPlayer) {
			return;
		}
		silentPlayer = new Audio(SILENT_WAV);
		silentPlayer.loop = true;
		silentPlayer.setAttribute('playsinline', '');
		silentPlayer.play().catch(function () {
			silentPlayer = null;
		});
	}

	function unlock() {
		startSilentPlayer();
		contexts.forEach(function (context) {
			if (context.state === 'running') {
				return;
			}
			context.resume();
			// Older WebKit also wants a sound started inside the gesture.
			const blip = context.createBufferSource();
			blip.buffer = context.createBuffer(1, 1, 22050);
			blip.connect(context.destination);
			blip.start(0);
		});
	}

	['touchend', 'pointerup', 'mousedown', 'keydown'].forEach(function (type) {
		window.addEventListener(type, unlock, { capture: true, passive: true });
	});
})();
