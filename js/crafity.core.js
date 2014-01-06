/*jslint browser: true, nomen: true, vars: true, white: true, forin: true */

(function (crafity) {
	"use strict";

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

	}(crafity.core = crafity.core || {}));

}(window.crafity = window.crafity || {}));
