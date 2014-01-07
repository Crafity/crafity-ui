/*jslint browser: true, nomen: true, vars: true, white: true*/

(function (crafity) {
	"use strict";

	(function (html) {

		function PasswordField() {
			var self = this;
			crafity.core.mixin(this, html.Field);

			this.addClass("PasswordField edit");
			this._PasswordField = this._control = new html.Element("input").attr("type", "password");
			this.append(this._PasswordField);
			this.value = function (value) {
				if (value === undefined) {
					return this._PasswordField.value();
				}
				this._PasswordField.value(value);
				return this;

			};

			this.on("readonlyChanged", function (bool) {
				if (bool === true) {
					self.removeClass("edit").addClass("readonly")
						._PasswordField.readonly(true).tabindex("-1");
				}
				if (bool === false) {
					self.addClass("edit").removeClass("readonly")
						._PasswordField.readonly(false).tabindex(null);
				}
			});
		}

		PasswordField.prototype = new html.Element("div");
		html.PasswordField = PasswordField;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
