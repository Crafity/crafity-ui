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
		Field.prototype.value = function (value) {
			if (!this._control) {
				throw new Error("Unable to get the value, because no _control has been assigned");
			}
			if (value === undefined) {
				return this._control.value();
			}
			this._control.value(value);
			return this;
		};
		Field.prototype.blur = function (callback) {
			if (!this._control) {
				throw new Error("Unable to register blur event, because no _control has been assigned");
			}
			this._control.blur(callback);
			return this;
		};
		Field.prototype.focus = function (callback) {
			if (!this._control) {
				throw new Error("Unable to register focus event, because no _control has been assigned");
			}
			this._control.focus(callback);
			return this;
		};
		Field.prototype.change = function (callback) {
			if (!this._control) {
				throw new Error("Unable to register change event, because no _control has been assigned");
			}
			this._control.change(callback);
			return this;
		};
		Field.prototype.reset = function () {
			this.removeClass("invalid");
			this._isValid = undefined; 
			this.value("");
			return this;
		};
		Field.prototype.verify = function () {
			if (this.isValid()) {
				this.removeClass("invalid");
			} else {
				this.addClass("invalid");
			}
			return this.isValid();
		};
		Field.prototype.required = function (value) {
			var self = this;
			if (value === true) {
				this.addClass("required");
				this._required = value;
				this.blur(function () {
					self.verify();
				});
			} else if (value === false) {
				this.removeClass("required");
				this._required = value;
			} else {
				return !!this._required;
			}
			return this;
		};
		Field.prototype.isValid = function () {
			return (!this._required || (this._required && !!this.value())) &&
				(this._isValid === undefined || this._isValid);
		};
		html.Field = Field;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
