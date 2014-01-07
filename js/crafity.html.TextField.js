/*jslint browser: true, nomen: true, vars: true, white: true*/

(function (crafity) {
	"use strict";

	(function (html) {

		function TextField() {
			var self = this;
			crafity.core.mixin(this, html.Field);

			this.addClass("textfield edit");
			this._textField = this._control = new html.Element("input").attr("type", "text");
			this.append(this._textField);
			this.value = function (value) {
				if (value === undefined) {
					return this._textField.value();
				}
				this._textField.value(value);
				return this;

			};

			this.on("readonlyChanged", function (bool) {
				if (bool === true) {
					self.removeClass("edit").addClass("readonly")
						._textField.readonly(true).tabindex("-1");
				}
				if (bool === false) {
					self.addClass("edit").removeClass("readonly")
						._textField.readonly(false).tabindex(null);
				}
			});
		}

		TextField.prototype = new html.Element("div");
		html.TextField = TextField;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
