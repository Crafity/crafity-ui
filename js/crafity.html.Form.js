/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function Form() {
			this.addClass("form");
		}

		Form.prototype = new html.Element("form");
		Form.prototype.verify = function () {
			var isValid = true;
			this.getChildren().filter(function (child) {
				return !!child.verify;
			}).forEach(function (child) {
					isValid = child.verify() && isValid;
				});
			return isValid;
		};
		Form.prototype.focus = function () {
			var self = this;
			html.Element.prototype.focus.apply(this, arguments);
			self.getChildren().length && self.getChildren()[0].focus();
			self.getChildren().some(function (child) {
				if (!child.verify()) { child.focus(); }
				return !child.isValid();
			});
		};
		html.Form = Form;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
