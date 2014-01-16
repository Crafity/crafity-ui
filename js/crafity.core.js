/*jslint browser: true, nomen: true, vars: true, white: true, forin: true */

(function (crafity) {
	"use strict";

	crafity.region = "nl";

	(function (core) {

		core.mixin = function mixin(target, Type) {
			var instance = new Type();
			var prop;

			for (prop in instance) {
				target[prop] = instance[prop];
			}
			target.prototype = instance;
			target.prototype.constructor = Type;
			return target;
		};

		core.hasTouch = function () {
			return ('ontouchstart' in window) || (window.DocumentTouch && document instanceof DocumentTouch);
		};

		core.events = {
			click: core.hasTouch() ? 'touchstart' : 'click',
			mouseup: core.hasTouch() ? 'touchend' : 'mouseup',
			mousemove: core.hasTouch() ? 'touchmove' : 'mousemove'
		};
	}(crafity.core = crafity.core || {}));

}(window.crafity = window.crafity || {}));
