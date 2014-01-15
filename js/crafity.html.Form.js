/*jslint browser: true, nomen: true, vars: true, white: true */

(function (crafity) {
	"use strict";

	(function (html) {

		function Form() {
			var self = this;
			this.addClass("form");
			this.on("readonlyChanged", function (value) {
				this.getChildren().forEach(function (child) {
					child.readonly(value);
				});
			});
		}

		Form.prototype = new html.Element("form");
		Form.prototype.addField = function (field) {
			this.append(field);
			return this;
		};
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
		Form.prototype.clear = function(){
			var self = this;
			self.getChildren().forEach(function(child){
				child.clear();
			});
		};
		Form.prototype.clearFields = function(){
				var self = this;
				self.getChildren().forEach(function(child){
					child.value("");
				});
			};
		
		html.Form = Form;

	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
