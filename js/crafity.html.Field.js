/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function Field() {
			this.addClass("field");
			this._innerSpan = new html.Element("span").addClass("border");
			this._label = new html.Element("label").append(this._innerSpan);
			this.append(this._label);
		}

		Field.prototype = new html.Element("div");
		Field.prototype.label = function (name) {
			if (!name) {
				return this._innerSpan.text();
			}
			this._innerSpan.text(name);
			return this;
		};
		html.Field = Field;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
