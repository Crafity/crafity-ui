/*jslint browser: true, nomen: true, vars: true, white: true */
/*globals console*/

(function (crafity) {
	"use strict";

		var emitter = new crafity.core.EventEmitter();

		window.addEventListener("keydown", function (e) {
			if (e.shiftKey && (e.metaKey || e.keyIdentifier === "U+004D") && e.which === 77) {
				console.log("cmd+shft+m");
				emitter.emit("cmd+shft+m", e);
				e.preventDefault();
				return false;
			}
			if (!e.shiftKey && e.metaKey && e.which === 69) {
				console.log("cmd+e");
				emitter.emit("cmd+e", e);
				e.preventDefault();
				return false;
			}
			if (!e.shiftKey && e.metaKey && e.which === 76) {
				console.log("cmd+l");
				emitter.emit("cmd+l", e);
				e.preventDefault();
				return false;
			}
			// U+0046 70 
			if (!e.shiftKey && e.metaKey && e.which === 70) {
				console.log("cmd+f");
				emitter.emit("cmd+f", e);
				e.preventDefault();
				return false;
			}
			if (!e.shiftKey && e.metaKey && e.which === 78) {
				emitter.emit("cmd+n", e);
				e.preventDefault();
				return false;
			}
			if (!e.shiftKey && e.metaKey && e.altKey && e.which === 192) {
				emitter.emit("cmd+opt+n", e);
				e.preventDefault();
				return false;
			}
			if (!e.shiftKey && e.keyIdentifier === "U+001B" && e.which === 27) {
				console.log("esc");
				emitter.emit("esc", e);
				e.preventDefault();
				return false;
			}
			if (e.which === 83 && (navigator.platform.match(/Mac/) ? e.metaKey : e.ctrlKey)) {
				console.log("cmd+s");
				emitter.emit("cmd+s", e);
				e.preventDefault();
				return false;
			}
			return true;
		});

		 crafity.keyboard = {
			on: function (shortcuts, callback) {
				[].concat(shortcuts).forEach(function (shortcut) {
					emitter.on(shortcut, callback);
				});
			}
		};
	
}(window.crafity = window.crafity || {}));
