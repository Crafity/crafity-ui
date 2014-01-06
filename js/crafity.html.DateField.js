/*jslint browser: true, nomen: true, vars: true, white: true*/

(function (crafity) {
	"use strict";

	(function (html) {

		function DateField() {
			var self = this;
			crafity.core.mixin(this, html.Field);
			this.addClass("datefield edit");
			this._dateField = new html.Element("input").attr("type", "text");
			this.append(this._dateField);
			this.value = function (value) {
				if (value === undefined) {
					return this._dateField.value();
				}
				this._dateField.value(value);
				return this;

			};
			this._dateField.addEventListener("blur", function (e) {
				var value = self._dateField.value();
				var parts;
				self._dateField.removeClass("invalid");

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
				self._dateField.focus();
				self._dateField.addClass("invalid");
				e.preventDefault();
				return false;
			});
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
		}

		DateField.prototype = new html.Element("div");
		html.DateField = DateField;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
