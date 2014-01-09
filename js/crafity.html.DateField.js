/*jslint browser: true, nomen: true, vars: true, white: true*/
/*globals moment*/

(function (crafity) {
	"use strict";

	(function (html) {

		function DateField() {
			var self = this;
			this._isValid = true;
			crafity.core.mixin(this, html.Field);
			this.addClass("datefield edit");
			this._dateField = this._control = new html.Element("input").attr("type", "text");
			this.append(this._dateField);
			this.value = function (value) {
				if (value === undefined) {
					return this._dateField.value();
				}
				this._dateField.value(value);
				return this;

			};
			this._dateField.addEventListener("blur", parseDate);
			this._dateField.addEventListener("change", parseDate);
			function parseDate(e) {
				var value = self._dateField.value();
				var parts;
				window.d = null;
				self._dateField.removeClass("invalid");
				self._isValid = true;
				self.verify();
				try {

					if (value.match(/^[0-9]{4,4}$/)) {
						return self._dateField.value(value.substr(0, 2) + '-' + value.substr(2, 2) + '-' + new Date().getFullYear());
					}
					if (value.match(/^[0-9]{6,6}$/)) {
						return self._dateField.value(value.substr(0, 2) + '-' + value.substr(2, 2) + '-20' + value.substr(4, 2));
					}
					if (value.match(/^[0-9]{8,8}$/)) {
						return self._dateField.value(value.substr(0, 2) + '-' + value.substr(2, 2) + '-' + value.substr(4, 4));
					}
					if (value.match(/^[0-9]{1,2}[\-][0-9]{1,2}$/)) {
						parts = value.split('-');
						parts[2] = new Date().getFullYear();
						return self._dateField.value(parts.join("-"));
					}
					if (value.match(/^[0-9]{1,2}[\-][0-9]{1,2}[\-][0-9]{1,1}$/)) {
						parts = value.split('-');
						parts[2] = "200" + parts[2];
						return self._dateField.value(parts.join("-"));
					}
					if (value.match(/^[0-9]{1,2}[\-][0-9]{1,2}[\-][0-9]{1,1}$/)) {
						parts = value.split('-');
						parts[2] = "200" + parts[2];
						return self._dateField.value(parts.join("-"));
					}
					if (value.match(/^[0-9]{1,2}[\-][0-9]{1,2}[\-][0-9]{2,2}$/)) {
						parts = value.split('-');
						parts[2] = "20" + parts[2];
						return self._dateField.value(parts.join("-"));
					}
					if (value.match(/^[0-9]{1,2}[\-][0-9]{1,2}[\-][0-9]{4,4}$/)) {
						return false;
					}
					if (value.length === 0) {
						return false;
					}
				} finally {
					if (self._dateField.value() && !moment(self._dateField.value(), crafity.region || "nl").isValid()) {
						self._isValid = false;
						self._dateField.focus();
						self._dateField.addClass("invalid");
						e.preventDefault();
						return false;
					} else if (self._dateField.value() === "") {
						return true;
					}
				}

				self._dateField.focus();
				self._dateField.addClass("invalid");
				self._isValid = false;
				e.preventDefault();
				return false;
			}

			this.on("readonlyChanged", function (bool) {
				if (bool === true) {
					self.removeClass("edit").addClass("readonly")
						._dateField.readonly(true).tabindex("-1")
						.attr("placeholder", "");
				}
				if (bool === false) {
					self.addClass("edit").removeClass("readonly")
						._dateField.readonly(false).tabindex(null)
						.attr("placeholder", "dd-mm-jjjj");
				}
			});

			this.change = function (callback) {
				if (callback === undefined) {
					throw new Error("Argument 'callback' is required");
				}
				this._dateField.change(function (value) {
					if (!self._isValid) { return; }
					if (value) {
						callback(moment(value, crafity.region || "nl").toDate());
					} else {
						callback(null);
					}
				});
				return this;
			};

		}

		DateField.prototype = new html.Element("div");
		html.DateField = DateField;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
