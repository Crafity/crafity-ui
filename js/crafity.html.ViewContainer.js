/*jslint browser: true, nomen: true, vars: true, white: true*/

(function (crafity) {
	"use strict";

	(function (html) {

		function ViewContainer() {
			var self = this;
			this.activate = function (view) {
				self.children().forEach(function (child) {
					if (child === view) {
						child.show();
					} else {
						child.hide();
					}
				});
				self.append(view);
			};
			this.deactivateAll = function () {
				self.children().forEach(function (child) {
					child.hide();
				});
			};
		}
		ViewContainer.prototype = new crafity.html.Element("div");
		
		html.ViewContainer = ViewContainer;
		
	}(crafity.html = crafity.html || {}));

}(window.crafity = window.crafity || {}));
		
