/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	function cmdOrCrl(e) {
		// (navigator.platform.match(/Mac/) ? e.metaKey : e.ctrlKey
		return ((e.metaKey && !e.ctrlKey) || (!e.metaKey && e.ctrlKey));
	}

	function attach(domElement) {
		var emitter = new crafity.core.EventEmitter();

		domElement.addEventListener("keydown", function (e) {
			if (e.shiftKey && cmdOrCrl(e) && e.which === 77) {
				emitter.emit("cmd+shft+m", "cmd+shft+m", e);
			}
			if (!e.shiftKey && cmdOrCrl(e) && e.which === 69) {
				emitter.emit("cmd+e", "cmd+e", e);
			}
			if (!e.shiftKey && cmdOrCrl(e) && e.which === 76) {
				emitter.emit("cmd+l", "cmd+l", e);
			}
			if (!e.shiftKey && cmdOrCrl(e) && e.which === 70) {
				emitter.emit("cmd+f", "cmd+f", e);
			}
			if (!e.shiftKey && cmdOrCrl(e) && e.which === 78) {
				emitter.emit("cmd+n", "cmd+n", e);
			}
			if (!e.shiftKey && cmdOrCrl(e) && e.altKey && e.which === 192) {
				emitter.emit("cmd+opt+n", "cmd+opt+n", e);
			}
			if (!e.shiftKey && e.keyIdentifier === "U+001B" && e.which === 27) {
				emitter.emit("esc", "esc", e);
			}
			if (!e.shiftKey && e.keyIdentifier === "U+0008" && !e.altKey && !e.metaKey && e.which === 8) {
				emitter.emit("backspace", "backspace", e);
			}
			if (!e.shiftKey && e.keyIdentifier === "Enter" && e.which === 13) {
				emitter.emit("enter", "enter", e);
			}
			if (e.which === 83 && cmdOrCrl(e)) {
				emitter.emit("cmd+s", "cmd+s", e);
			}
			return true;
		});

		return {
			on: function (shortcuts, callback) {
				[].concat(shortcuts).forEach(function (shortcut) {
					emitter.on(shortcut, callback);
				});
			},
			removeAllListeners: function () {
				emitter.removeAllListeners();
			},
			attach: function (element) {
				return attach(element.element && element.element() || element);
			}
		};
	}

	crafity.keyboard = attach(window);

}(window.crafity = window.crafity || {}));
