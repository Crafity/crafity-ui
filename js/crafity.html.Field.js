/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function Field() {
			this.addClass("field");
			this._innerSpan = new html.Element("span").addClass("border");
			this._label = new html.Element("label").append(this._innerSpan);
			this._control = null;
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
		Field.prototype.blur = function (callback) {
			if (!this._control) {
				throw new Error("Unable to register blur event, because no _control has been assigned");
			}
			this._control.blur(callback);
		};
		Field.prototype.focus = function (callback) {
			if (!this._control) {
				throw new Error("Unable to register focus event, because no _control has been assigned");
			}
			this._control.focus(callback);
		};
		Field.prototype.change = function (callback) {
			if (!this._control) {
				throw new Error("Unable to register change event, because no _control has been assigned");
			}
			this._control.change(callback);
		};
		html.Field = Field;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
